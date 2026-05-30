import { EditAction, EditPlan, AgentDeliberation } from "@/lib/edit-core/types";
import { CreatorProfile, formatCreatorProfileForPrompt } from "@/lib/edit-core/creator-profile";

export interface AgentResult {
  actions: EditAction[];
  rationale: AgentDeliberation[];
}

export interface AgentContext {
  ollamaBaseUrl: string;
  ollamaModel: string;
  enabled: boolean;
  timeoutMs?: number;
  creatorProfile?: CreatorProfile;
  customInstructions?: string;
}

export function agentResult(rationale: AgentDeliberation[], actions: EditAction[] = []): AgentResult {
  return { actions, rationale };
}

export function visualActions(plan: EditPlan) {
  return plan.actions.filter((action) => action.kind === "place_clip");
}

const DEFAULT_TIMEOUT_MS = 12000;

export interface OllamaAgentRequest {
  role: AgentDeliberation["agent"];
  instructions: string;
  inputJson: unknown;
  /**
   * Minimal JSON schema description embedded into the prompt. The actual
   * structured-output contract is enforced via `format: "json"` in Ollama
   * and a strict JSON parse on our side; if either fails we degrade to the
   * provided fallback rationale instead of throwing.
   */
  responseShape: string;
}

export interface OllamaAgentResponse {
  claim?: string;
  evidence?: string[];
  confidence?: number;
  notes?: string;
  actions?: unknown[];
}

export async function callOllamaAgent(
  context: AgentContext | undefined,
  request: OllamaAgentRequest,
): Promise<OllamaAgentResponse | null> {
  if (!context || !context.enabled || !context.ollamaBaseUrl || !context.ollamaModel) {
    return null;
  }

  const profileBlock = context.creatorProfile
    ? `Creator profile:\n${formatCreatorProfileForPrompt(context.creatorProfile)}`
    : "Creator profile: not provided";

  const prompt = [
    `You are the "${request.role}" agent inside the Weave Edit autopilot for Premiere Pro.`,
    "You analyze the JSON plan and return strict JSON only - no commentary outside the JSON object.",
    request.instructions,
    profileBlock,
    context.customInstructions ? `Custom direction: ${context.customInstructions}` : "",
    `Plan input (JSON): ${JSON.stringify(request.inputJson)}`,
    `Respond as JSON matching this shape: ${request.responseShape}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const timeoutMs = context.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${normalizeOllamaUrl(context.ollamaBaseUrl)}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: context.ollamaModel,
        prompt,
        format: "json",
        stream: false,
        options: { temperature: 0.2 },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { response?: string };
    return parseAgentJson(payload.response ?? "");
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export function buildDeliberation(
  agent: AgentDeliberation["agent"],
  staticFallback: AgentDeliberation,
  response: OllamaAgentResponse | null,
): AgentDeliberation {
  if (!response || typeof response !== "object") {
    return staticFallback;
  }
  const claim = typeof response.claim === "string" && response.claim.trim() ? response.claim.trim() : staticFallback.claim;
  const evidence = Array.isArray(response.evidence)
    ? response.evidence.map((value) => String(value)).slice(0, 6)
    : staticFallback.evidence;
  const confidence = typeof response.confidence === "number" && Number.isFinite(response.confidence)
    ? Math.max(0, Math.min(1, response.confidence))
    : staticFallback.confidence;
  return { agent, claim, evidence, confidence };
}

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Multi-turn chat transport against Ollama's /api/chat endpoint. Returns the raw assistant
 * content string (callers parse JSON with parseJsonLoose) or null on any failure, matching
 * the degrade-to-fallback contract used by callOllamaAgent.
 */
export async function chatWithOllama(
  context: AgentContext | undefined,
  messages: OllamaChatMessage[],
  options: { format?: "json"; temperature?: number; timeoutMs?: number } = {},
): Promise<string | null> {
  if (!context || !context.enabled || !context.ollamaBaseUrl || !context.ollamaModel) {
    return null;
  }

  const timeoutMs = options.timeoutMs ?? context.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${normalizeOllamaUrl(context.ollamaBaseUrl)}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: context.ollamaModel,
        messages,
        stream: false,
        ...(options.format ? { format: options.format } : {}),
        options: { temperature: options.temperature ?? 0.3 },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { message?: { content?: string } };
    return payload.message?.content ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function normalizeOllamaUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Parses the first JSON object found in a model response. Tolerates leading/trailing
 * commentary by falling back to the first {...} match. Returns null when nothing parses.
 */
export function parseJsonLoose<T = unknown>(text: string): T | null {
  if (!text) {
    return null;
  }
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const match = /\{[\s\S]*\}/.exec(trimmed);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

function parseAgentJson(text: string): OllamaAgentResponse | null {
  return parseJsonLoose<OllamaAgentResponse>(text);
}
