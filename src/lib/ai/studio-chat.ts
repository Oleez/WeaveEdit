import { AgentDeliberation } from "@/lib/edit-core/types";
import { formatSeconds } from "@/lib/script-parser";
import {
  AgentContext,
  OllamaChatMessage,
  chatWithOllama,
  parseJsonLoose,
} from "./agents/shared";

export type StudioToolName =
  | "edit_script"
  | "apply_edit_ops"
  | "generate_image"
  | "batch_generate_images";

export const STUDIO_TOOLS: StudioToolName[] = [
  "edit_script",
  "apply_edit_ops",
  "generate_image",
  "batch_generate_images",
];

const VALID_TOOLS = new Set<StudioToolName>(STUDIO_TOOLS);

export interface StudioToolCall {
  tool: StudioToolName;
  args: Record<string, unknown>;
}

export interface StudioToolResult {
  ok: boolean;
  /** Short line shown as activity in the UI and fed back to the model. */
  summary: string;
  deliberation?: AgentDeliberation[];
}

/** Callbacks supplied by the React layer; each owns its slice of plan/script/host state. */
export type ToolRegistry = Partial<
  Record<StudioToolName, (args: Record<string, unknown>) => Promise<StudioToolResult>>
>;

export interface StudioChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Tool-activity lines attached to an assistant turn (rendered under the bubble). */
  activity?: string[];
}

export interface StudioChatContext {
  playheadSec: number;
  hasScript: boolean;
  hasPlan: boolean;
  sequenceName?: string;
}

export interface StudioChatResult {
  reply: string;
  activity: string[];
  deliberation: AgentDeliberation[];
  toolCalls: StudioToolCall[];
}

interface RunStudioChatParams {
  history: StudioChatMessage[];
  userMessage: string;
  agentContext?: AgentContext;
  registry: ToolRegistry;
  context: StudioChatContext;
  /** Max planning rounds (each can fire tool calls and feed results back). Default 2. */
  maxIterations?: number;
}

function buildSystemPrompt(context: StudioChatContext): string {
  return [
    "You are the orchestrator for the Weave Edit agent studio inside Adobe Premiere Pro.",
    "You help a creator edit their video by conversing and by calling tools that act on the script and timeline.",
    `Playhead is at ${formatSeconds(context.playheadSec)}.`,
    context.hasScript ? "A timestamped script is loaded." : "No script is loaded yet.",
    context.hasPlan ? "An edit plan exists for the timeline." : "No edit plan exists yet.",
    context.sequenceName ? `Active sequence: ${context.sequenceName}.` : "",
    "Available tools:",
    '- edit_script: rewrite the ONE script line at the playhead. args: {"instruction": string, "atSec"?: number, "scope"?: "line"|"all"}',
    '- apply_edit_ops: apply timeline edits from a plain-language request (tighten, punch-in, captions, audio polish, transitions, color match, replace b-roll). args: {"request": string}',
    '- generate_image: prompt-engineer then generate ONE image with gpt-image-1 and place it on the timeline at the playhead. args: {"idea"?: string, "atSec"?: number}',
    '- batch_generate_images: generate B-roll images across a section only where visual coverage is missing. Use sparingly. args: {"maxImages"?: number, "sectionStartSec"?: number, "sectionEndSec"?: number}',
    'Respond with STRICT JSON ONLY and nothing else: {"reply": string, "tool_calls": [{"tool": string, "args": object}]}.',
    "reply is a short message to the creator. tool_calls is [] when the user only wants conversation or information.",
    "Never invent tools and never call a tool the user did not ask for.",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeToolCalls(raw: unknown): StudioToolCall[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const calls: StudioToolCall[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const tool = (entry as { tool?: unknown }).tool;
    if (typeof tool !== "string" || !VALID_TOOLS.has(tool as StudioToolName)) {
      continue;
    }
    const args = (entry as { args?: unknown }).args;
    calls.push({
      tool: tool as StudioToolName,
      args: args && typeof args === "object" ? (args as Record<string, unknown>) : {},
    });
  }
  return calls;
}

async function executeToolCalls(
  toolCalls: StudioToolCall[],
  registry: ToolRegistry,
  activity: string[],
  deliberation: AgentDeliberation[],
  executed: StudioToolCall[],
): Promise<string[]> {
  const resultsForModel: string[] = [];
  for (const call of toolCalls) {
    executed.push(call);
    const handler = registry[call.tool];
    if (!handler) {
      const message = `Tool ${call.tool} is not available right now.`;
      activity.push(message);
      resultsForModel.push(message);
      continue;
    }
    try {
      const result = await handler(call.args);
      activity.push(result.summary);
      if (result.deliberation?.length) {
        deliberation.push(...result.deliberation);
      }
      resultsForModel.push(`${call.tool}: ${result.summary}`);
    } catch (error) {
      const message = `${call.tool} failed: ${error instanceof Error ? error.message : String(error)}`;
      activity.push(message);
      resultsForModel.push(message);
    }
  }
  return resultsForModel;
}

/**
 * Drives a bounded tool-dispatch conversation with the local gemma model. The model proposes
 * a reply plus optional tool_calls; we execute them through the injected registry, feed the
 * results back, and loop up to maxIterations. On a JSON-parse miss we degrade to treating the
 * raw message as an apply_edit_ops request (which itself falls back to the heuristic router).
 */
export async function runStudioChat(params: RunStudioChatParams): Promise<StudioChatResult> {
  const { history, userMessage, agentContext, registry, context } = params;
  const maxIterations = Math.max(1, params.maxIterations ?? 2);

  const messages: OllamaChatMessage[] = [{ role: "system", content: buildSystemPrompt(context) }];
  for (const entry of history) {
    messages.push({ role: entry.role, content: entry.content });
  }
  messages.push({ role: "user", content: userMessage });

  const activity: string[] = [];
  const deliberation: AgentDeliberation[] = [];
  const executed: StudioToolCall[] = [];
  let finalReply = "";

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const content = await chatWithOllama(agentContext, messages, { format: "json", temperature: 0.3 });
    const parsed = content
      ? parseJsonLoose<{ reply?: unknown; tool_calls?: unknown }>(content)
      : null;

    if (!parsed) {
      if (iteration === 0 && registry.apply_edit_ops) {
        const result = await registry.apply_edit_ops({ request: userMessage });
        executed.push({ tool: "apply_edit_ops", args: { request: userMessage } });
        if (result.deliberation?.length) {
          deliberation.push(...result.deliberation);
        }
        // The summary IS the reply here; pushing it to activity too would render it twice.
        finalReply = result.summary;
      } else {
        finalReply = finalReply || "Sorry, I couldn't understand that. Try rephrasing the edit you want.";
      }
      break;
    }

    const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
    if (reply) {
      finalReply = reply;
    }

    const toolCalls = normalizeToolCalls(parsed.tool_calls);
    if (toolCalls.length === 0) {
      break;
    }

    messages.push({ role: "assistant", content: content ?? "" });
    const resultsForModel = await executeToolCalls(toolCalls, registry, activity, deliberation, executed);
    messages.push({
      role: "user",
      content: `Tool results:\n${resultsForModel.join("\n")}\nIf the task is complete, reply with {"reply": "...", "tool_calls": []}.`,
    });
  }

  if (!finalReply) {
    finalReply = activity.length ? activity.join(" ") : "Done.";
  }

  return { reply: finalReply, activity, deliberation, toolCalls: executed };
}
