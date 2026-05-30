import { AgentContext, callOllamaAgent } from "./shared";

export interface ScriptEditorInput {
  originalLine: string;
  instruction: string;
  contextBefore?: string;
  contextAfter?: string;
}

export interface ScriptEditorResult {
  newText: string;
  claim: string;
  confidence: number;
  changed: boolean;
}

/**
 * Rewrites a single script line in place using the local gemma model. Always degrades to the
 * original line (low confidence) when AI is off or the model response is unusable.
 */
export async function editScriptLine(
  input: ScriptEditorInput,
  agentContext?: AgentContext,
): Promise<ScriptEditorResult> {
  const fallback: ScriptEditorResult = {
    newText: input.originalLine,
    claim: "Local edit model unavailable; left the line unchanged.",
    confidence: 0.2,
    changed: false,
  };

  if (!agentContext?.enabled) {
    return fallback;
  }

  const response = await callOllamaAgent(agentContext, {
    role: "script-editor",
    instructions: [
      "You are rewriting ONE line of a video script in place, following the user's instruction.",
      "Preserve the speaker's voice and intent unless the instruction explicitly asks to change them.",
      "Return ONLY the rewritten line text in newText - no timestamps, no surrounding quotes, no commentary.",
      "If the instruction does not apply to this line, return the original line unchanged and set confidence below 0.4.",
    ].join(" "),
    inputJson: {
      originalLine: input.originalLine,
      instruction: input.instruction,
      contextBefore: input.contextBefore ?? "",
      contextAfter: input.contextAfter ?? "",
    },
    responseShape: '{"newText": string, "claim": string, "evidence": string[], "confidence": number}',
  });

  const rawNewText = (response as unknown as { newText?: unknown })?.newText;
  const newText = typeof rawNewText === "string" ? rawNewText.trim() : "";

  if (!response || !newText) {
    return fallback;
  }

  return {
    newText,
    claim:
      typeof response.claim === "string" && response.claim.trim()
        ? response.claim.trim()
        : "Rewrote the line per your instruction.",
    confidence:
      typeof response.confidence === "number" && Number.isFinite(response.confidence)
        ? Math.max(0, Math.min(1, response.confidence))
        : 0.6,
    changed: newText !== input.originalLine.trim(),
  };
}
