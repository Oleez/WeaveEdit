import { ChatEditIntent, EditPlan } from "@/lib/edit-core/types";
import { replanFromIntent } from "@/lib/edit-core/autopilot";
import { AgentContext, callOllamaAgent } from "./shared";

const VALID_OPS = new Set([
  "tighten",
  "punch_in",
  "captions",
  "audio_polish",
  "transitions",
  "color_match",
  "replace_broll",
]);

export function parseChatIntent(rawText: string): ChatEditIntent {
  const text = rawText.toLowerCase();
  const ops: ChatEditIntent["ops"] = [];

  if (/(tight|silence|faster|snappier|200ms|0\.2)/.test(text)) {
    ops.push({ kind: "tighten", value: text.includes("200") || text.includes("0.2") ? 0.2 : 0.35 });
  }
  if (/(punch|zoom|push in|claim|emphasis)/.test(text)) {
    ops.push({ kind: "punch_in", value: 112 });
  }
  if (/(caption|subtitle|words)/.test(text)) {
    ops.push({ kind: "captions" });
  }
  if (/(audio|lufs|duck|music|loud)/.test(text)) {
    ops.push({ kind: "audio_polish" });
  }
  if (/(transition|dissolve|smooth)/.test(text)) {
    ops.push({ kind: "transitions" });
  }
  if (/(color|grade|match)/.test(text)) {
    ops.push({ kind: "color_match" });
  }

  return {
    rawText,
    ops: ops.length > 0 ? ops : [{ kind: "replace_broll", target: "low_confidence" }],
  };
}

export async function parseChatIntentWithLlm(
  rawText: string,
  agentContext?: AgentContext,
): Promise<ChatEditIntent> {
  if (!agentContext?.enabled) {
    return parseChatIntent(rawText);
  }

  const response = await callOllamaAgent(agentContext, {
    role: "chat-router",
    instructions:
      "Translate the user's plain-language edit request into a list of structured operations. Each op kind must be one of: tighten, punch_in, captions, audio_polish, transitions, color_match, replace_broll. Include numeric values when the user specified them (e.g. tighten value 0.2 for 200ms). Never invent ops the user did not request.",
    inputJson: { request: rawText },
    responseShape:
      '{"ops": [{"kind": "tighten|punch_in|captions|audio_polish|transitions|color_match|replace_broll", "target": string?, "value": number|string?}], "claim": string, "evidence": string[], "confidence": number}',
  });

  if (!response || !Array.isArray(response.actions ?? (response as unknown as { ops?: unknown[] }).ops)) {
    // Some Ollama models return `actions` instead of `ops`; treat either as the intent list.
    const ops = (response as unknown as { ops?: Array<{ kind?: string; target?: string; value?: number | string }> })?.ops;
    if (!Array.isArray(ops)) {
      return parseChatIntent(rawText);
    }
    return {
      rawText,
      ops: ops
        .filter((op) => op && typeof op.kind === "string" && VALID_OPS.has(op.kind))
        .map((op) => ({ kind: op.kind as ChatEditIntent["ops"][number]["kind"], target: op.target, value: op.value })),
    };
  }

  const rawOps = (response as unknown as { ops?: Array<{ kind?: string; target?: string; value?: number | string }> }).ops;
  if (!Array.isArray(rawOps) || rawOps.length === 0) {
    return parseChatIntent(rawText);
  }

  const ops = rawOps
    .filter((op) => op && typeof op.kind === "string" && VALID_OPS.has(op.kind))
    .map((op) => ({
      kind: op.kind as ChatEditIntent["ops"][number]["kind"],
      target: typeof op.target === "string" ? op.target : undefined,
      value: typeof op.value === "number" || typeof op.value === "string" ? op.value : undefined,
    }));

  return { rawText, ops: ops.length > 0 ? ops : parseChatIntent(rawText).ops };
}

export async function routeChatToPlan(
  plan: EditPlan,
  rawText: string,
  agentContext?: AgentContext,
): Promise<EditPlan> {
  const intent = await parseChatIntentWithLlm(rawText, agentContext);
  return replanFromIntent(plan, intent);
}
