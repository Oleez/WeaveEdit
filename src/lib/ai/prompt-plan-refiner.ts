import type { AiMode, AiScoringContext, MissingAssetPlan, MissingAssetPrompt } from "./types";

interface RefinementPayload {
  promptText?: string;
  negativePrompt?: string;
  styleNotes?: string;
  reason?: string;
  usage?: MissingAssetPrompt["usage"];
  suggestedToolCategory?: MissingAssetPrompt["suggestedToolCategory"];
  refinementNote?: string;
}

interface OllamaGenerateResponse {
  response?: string;
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

export interface PromptPlanRefinementResult {
  plan: MissingAssetPlan;
  providerUsed: string | null;
  refinedCount: number;
  errors: string[];
}

const DEFAULT_TIMEOUT_MS = 18000;

export async function refineMissingAssetPlanWithAi(
  plan: MissingAssetPlan,
  mode: AiMode,
  context: AiScoringContext,
  onProgress?: (done: number, total: number) => void,
): Promise<PromptPlanRefinementResult> {
  if (mode === "off") {
    return {
      plan,
      providerUsed: null,
      refinedCount: 0,
      errors: ["AI mode is off. Rule-generated prompts were kept."],
    };
  }

  if (plan.prompts.length === 0) {
    return { plan, providerUsed: null, refinedCount: 0, errors: [] };
  }

  const refinedPrompts: MissingAssetPrompt[] = [];
  const errors: string[] = [];
  let providerUsed: string | null = null;
  let refinedCount = 0;

  for (const prompt of plan.prompts) {
    const result = await refineOnePrompt(prompt, mode, context);
    if (result.prompt.aiRefined) {
      refinedCount += 1;
      providerUsed = providerUsed ?? result.prompt.refinementProvider ?? null;
    }
    if (result.error) {
      errors.push(`${prompt.id}: ${result.error}`);
    }
    refinedPrompts.push(result.prompt);
    onProgress?.(refinedPrompts.length, plan.prompts.length);
  }

  return {
    plan: {
      ...plan,
      prompts: refinedPrompts,
      highPriorityCount: refinedPrompts.filter((prompt) => prompt.priority === "high").length,
      generatedAt: new Date().toISOString(),
    },
    providerUsed,
    refinedCount,
    errors,
  };
}

async function refineOnePrompt(
  prompt: MissingAssetPrompt,
  mode: AiMode,
  context: AiScoringContext,
): Promise<{ prompt: MissingAssetPrompt; error?: string }> {
  try {
    const refined = await refineWithOllama(prompt, context);
    return { prompt: mergeRefinement(prompt, refined, "ollama") };
  } catch (ollamaError) {
    if (mode !== "hybrid" || !context.geminiApiKey) {
      return { prompt, error: `Ollama refinement unavailable: ${String(ollamaError)}` };
    }

    try {
      const refined = await refineWithGemini(prompt, context);
      return { prompt: mergeRefinement(prompt, refined, "gemini") };
    } catch (geminiError) {
      return {
        prompt,
        error: `Ollama failed (${String(ollamaError)}); Gemini fallback failed (${String(geminiError)}).`,
      };
    }
  }
}

async function refineWithOllama(
  prompt: MissingAssetPrompt,
  context: AiScoringContext,
): Promise<RefinementPayload> {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(context.ollamaBaseUrl)}/api/generate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: context.ollamaModel || "gemma4:e4b",
        prompt: buildRefinementPrompt(prompt, context),
        stream: false,
        format: "json",
        options: { temperature: 0.25 },
      }),
    },
    context.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status}`);
  }

  const payload = (await response.json()) as OllamaGenerateResponse;
  return parseRefinementPayload(payload.response ?? "");
}

async function refineWithGemini(
  prompt: MissingAssetPrompt,
  context: AiScoringContext,
): Promise<RefinementPayload> {
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${context.geminiModel}:generateContent?key=${context.geminiApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildRefinementPrompt(prompt, context) }] }],
        generationConfig: {
          temperature: 0.25,
          responseMimeType: "application/json",
        },
      }),
    },
    context.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`Gemini HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GeminiGenerateResponse;
  return parseRefinementPayload(payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
}

function buildRefinementPrompt(prompt: MissingAssetPrompt, context: AiScoringContext): string {
  return [
    "You are refining a missing-asset prompt brief for a Premiere short-form editing panel.",
    "Return strict JSON only. Preserve all timestamps and required metadata by refining only the fields listed below.",
    'JSON shape: {"promptText":"...","negativePrompt":"...","styleNotes":"...","reason":"...","usage":"replace blank|replace fallback|enhance existing media","suggestedToolCategory":"image generator|video generator|music generator|SFX library|rotoscope tool","refinementNote":"short sentence"}',
    "Do not call external tools. Do not generate assets. Do not invent unrelated visuals.",
    "Do not name copyrighted artists, films, brands, or famous songs as style references.",
    context.editGoal ? `Edit goal: ${context.editGoal}` : "",
    context.editStyle ? `Edit style: ${context.editStyle}` : "",
    context.brollStyle ? `B-roll style: ${context.brollStyle}` : "",
    context.captionStyle ? `Caption style: ${context.captionStyle}` : "",
    context.ctaContext ? `CTA context: ${context.ctaContext}` : "",
    context.creativeDirection ? `Creative direction: ${context.creativeDirection}` : "",
    context.brandNotes ? `Brand notes: ${context.brandNotes}` : "",
    "",
    `Placement id: ${prompt.placementId}`,
    `Timestamp: ${prompt.startSec.toFixed(2)} - ${prompt.endSec.toFixed(2)}`,
    `Transcript: "${prompt.transcriptText}"`,
    `Editorial role: ${prompt.editorialRole}`,
    `Visual intent: ${prompt.visualIntent}`,
    `Visual mode: ${prompt.visualMode}`,
    `Suggested asset type: ${prompt.suggestedAssetType}`,
    `Suggested tool category: ${prompt.suggestedToolCategory}`,
    `Priority: ${prompt.priority}`,
    `Current usage: ${prompt.usage}`,
    `Why needed: ${prompt.reason}`,
    `Current prompt: ${prompt.promptText}`,
    prompt.negativePrompt ? `Current avoid notes: ${prompt.negativePrompt}` : "",
    prompt.styleNotes ? `Current style notes: ${prompt.styleNotes}` : "",
    "",
    "For video generator prompts, include camera motion, duration suggestion, framing, lighting, subject/action, and mood.",
    "For image prompts, include composition, subject, lighting, background, mood, and aspect ratio when useful.",
    "For music prompts, use copyright-safe mood, tempo, instrumentation, and structure only.",
    "For Premium Business, keep it realistic, clean, high-end, modern, and not cheesy.",
  ]
    .filter(Boolean)
    .join("\n");
}

function mergeRefinement(
  prompt: MissingAssetPrompt,
  refined: RefinementPayload,
  provider: string,
): MissingAssetPrompt {
  return {
    ...prompt,
    promptText: cleanText(refined.promptText) ?? prompt.promptText,
    negativePrompt: cleanText(refined.negativePrompt) ?? prompt.negativePrompt,
    styleNotes: cleanText(refined.styleNotes) ?? prompt.styleNotes,
    reason: cleanText(refined.reason) ?? prompt.reason,
    usage: normalizeUsage(refined.usage) ?? prompt.usage,
    suggestedToolCategory: normalizeToolCategory(refined.suggestedToolCategory) ?? prompt.suggestedToolCategory,
    aiRefined: true,
    refinementProvider: provider,
    refinementNote: cleanText(refined.refinementNote) ?? `Refined with ${provider}.`,
    originalPromptText: prompt.originalPromptText ?? prompt.promptText,
    originalNegativePrompt: prompt.originalNegativePrompt ?? prompt.negativePrompt,
    originalStyleNotes: prompt.originalStyleNotes ?? prompt.styleNotes,
    originalReason: prompt.originalReason ?? prompt.reason,
    originalUsage: prompt.originalUsage ?? prompt.usage,
    refinedAt: new Date().toISOString(),
  };
}

export function resetPromptRefinement(prompt: MissingAssetPrompt): MissingAssetPrompt {
  if (!prompt.aiRefined) {
    return prompt;
  }

  const {
    aiRefined,
    refinementProvider,
    refinementNote,
    originalPromptText,
    originalNegativePrompt,
    originalStyleNotes,
    originalReason,
    originalUsage,
    refinedAt,
    ...rest
  } = prompt;

  return {
    ...rest,
    promptText: originalPromptText ?? prompt.promptText,
    negativePrompt: originalNegativePrompt,
    styleNotes: originalStyleNotes ?? prompt.styleNotes,
    reason: originalReason ?? prompt.reason,
    usage: originalUsage ?? prompt.usage,
  };
}

function parseRefinementPayload(raw: string): RefinementPayload {
  const parsed = safeJsonParse(extractJsonObject(raw)) as RefinementPayload | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid JSON refinement output");
  }
  if (!cleanText(parsed.promptText) && !cleanText(parsed.negativePrompt) && !cleanText(parsed.styleNotes)) {
    throw new Error("Refinement output did not include usable prompt fields");
  }
  return parsed;
}

function normalizeUsage(value: unknown): MissingAssetPrompt["usage"] | undefined {
  return value === "replace blank" || value === "replace fallback" || value === "enhance existing media"
    ? value
    : undefined;
}

function normalizeToolCategory(value: unknown): MissingAssetPrompt["suggestedToolCategory"] | undefined {
  return value === "image generator" ||
    value === "video generator" ||
    value === "music generator" ||
    value === "SFX library" ||
    value === "rotoscope tool"
    ? value
    : undefined;
}

function cleanText(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : undefined;
}

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}
