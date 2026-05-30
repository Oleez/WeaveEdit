import { AgentContext, callOllamaAgent } from "./shared";

export interface PromptEngineerInput {
  /** The script line or free-form idea to turn into an image. */
  idea: string;
  editorialRole?: string;
  /** Composed style guidance (edit style, b-roll style, brand notes, etc.). */
  styleNotes?: string;
}

export interface EngineeredImagePrompt {
  prompt: string;
  negativePrompt: string;
  size: string;
  claim: string;
  confidence: number;
}

const DEFAULT_NEGATIVE =
  "text overlays, watermarks, logos, captions, distorted hands, extra fingers, low quality, blurry, cartoonish, oversaturated";

const VALID_SIZES = new Set(["1536x1024", "1024x1024", "1024x1536"]);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeSize(value: unknown): string {
  return typeof value === "string" && VALID_SIZES.has(value) ? value : "1536x1024";
}

function buildFallbackPrompt(input: PromptEngineerInput): string {
  const role = input.editorialRole ? ` (${input.editorialRole} beat)` : "";
  const style = input.styleNotes ? ` Style: ${input.styleNotes}.` : "";
  return [
    `Photorealistic, premium cinematic B-roll still that visually supports this idea${role}: "${input.idea.trim()}".`,
    "Specific, modern, and useful for a professional video editor. Natural lighting, shallow depth of field, no on-screen text.",
    style,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

/**
 * Turns a script line / idea into a polished gpt-image-1 prompt using the local gemma model,
 * acting as a "prompt engineer". Always degrades to a solid heuristic prompt when AI is off.
 */
export async function engineerImagePrompt(
  input: PromptEngineerInput,
  agentContext?: AgentContext,
): Promise<EngineeredImagePrompt> {
  const fallback: EngineeredImagePrompt = {
    prompt: buildFallbackPrompt(input),
    negativePrompt: DEFAULT_NEGATIVE,
    size: "1536x1024",
    claim: "Used a heuristic image prompt (local model unavailable).",
    confidence: 0.4,
  };

  if (!agentContext?.enabled) {
    return fallback;
  }

  const response = await callOllamaAgent(agentContext, {
    role: "prompt-engineer",
    instructions: [
      "You are a senior prompt engineer for the gpt-image-1 model, producing premium B-roll stills for a video editor.",
      "Write ONE vivid, specific, photorealistic prompt that visually supports the idea and the editorial role.",
      "Never request on-screen text, captions, logos, or watermarks. Keep it tasteful and modern.",
      "Return prompt, negativePrompt, and size. Use 1536x1024 for widescreen video unless a square/portrait clearly fits better.",
    ].join(" "),
    inputJson: {
      idea: input.idea,
      editorialRole: input.editorialRole ?? "",
      styleNotes: input.styleNotes ?? "",
    },
    responseShape:
      '{"prompt": string, "negativePrompt": string, "size": "1536x1024|1024x1024|1024x1536", "claim": string, "evidence": string[], "confidence": number}',
  });

  const rawPrompt = (response as unknown as { prompt?: unknown })?.prompt;
  const prompt = typeof rawPrompt === "string" ? rawPrompt.trim() : "";
  if (!response || !prompt) {
    return fallback;
  }

  const rawNegative = (response as unknown as { negativePrompt?: unknown }).negativePrompt;
  const rawSize = (response as unknown as { size?: unknown }).size;

  return {
    prompt,
    negativePrompt:
      typeof rawNegative === "string" && rawNegative.trim() ? rawNegative.trim() : DEFAULT_NEGATIVE,
    size: normalizeSize(rawSize),
    claim:
      typeof response.claim === "string" && response.claim.trim()
        ? response.claim.trim()
        : "Engineered an image prompt for this moment.",
    confidence:
      typeof response.confidence === "number" && Number.isFinite(response.confidence)
        ? clamp01(response.confidence)
        : 0.6,
  };
}
