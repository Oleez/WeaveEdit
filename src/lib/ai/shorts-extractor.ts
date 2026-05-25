import type { ScriptSegment } from "@/lib/script-parser";
import type {
  AiMode,
  AiScoringContext,
  ShortCandidate,
  ShortCandidateEditNotes,
  ShortCandidateScore,
  ShortExtractionResult,
  ShortExtractionSettings,
  ShortPlatform,
  ShortWarning,
} from "./types";

interface CandidateWindow {
  segments: ScriptSegment[];
  startSec: number;
  endSec: number;
  durationSec: number;
  text: string;
}

interface AiShortsPayload {
  candidates?: Array<Partial<ShortCandidate> & { id?: string; scores?: Partial<ShortCandidateScore> }>;
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

const DEFAULT_TIMEOUT_MS = 18000;
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "you",
  "your",
  "that",
  "this",
  "with",
  "from",
  "into",
  "they",
  "them",
  "then",
  "than",
  "have",
  "has",
  "are",
  "was",
  "were",
  "but",
  "not",
  "can",
  "will",
  "just",
  "about",
  "what",
  "when",
  "where",
  "why",
  "how",
]);

export function extractShortsHeuristic(
  segments: ScriptSegment[],
  settings: ShortExtractionSettings,
  fullScriptContext = "",
): ShortExtractionResult {
  const normalizedSegments = segments
    .filter((segment) => segment.text.trim().length > 0)
    .map((segment, index, all) => ({
      ...segment,
      endSec: resolveEndSec(segment, all[index + 1]),
    }))
    .filter((segment): segment is ScriptSegment & { endSec: number } => typeof segment.endSec === "number" && segment.endSec > segment.startSec);

  const windows = buildCandidateWindows(normalizedSegments, settings);
  const scored = windows
    .map((window, index) => buildCandidate(window, settings, index, fullScriptContext))
    .filter((candidate) => candidate.scores.hook >= settings.minHookScore && candidate.scores.completeness >= settings.minCompletenessScore)
    .sort((left, right) => right.scores.overall - left.scores.overall);

  const deduped = dedupeCandidates(scored, settings).slice(0, settings.clipCount);

  return {
    candidates: deduped,
    generatedAt: new Date().toISOString(),
    providerUsed: "heuristic",
    errors: [],
    settings,
  };
}

export async function extractShortsWithAi(
  segments: ScriptSegment[],
  settings: ShortExtractionSettings,
  mode: AiMode,
  context: AiScoringContext,
): Promise<ShortExtractionResult> {
  const base = extractShortsHeuristic(segments, settings, context.fullScriptContext);
  if (mode === "off" || base.candidates.length === 0) {
    return base;
  }

  const errors: string[] = [];
  const providers: Array<"ollama" | "gemini"> = mode === "hybrid" && context.geminiApiKey ? ["ollama", "gemini"] : ["ollama"];

  for (const provider of providers) {
    try {
      const refined = provider === "ollama"
        ? await refineWithOllama(base.candidates, settings, context)
        : await refineWithGemini(base.candidates, settings, context);

      return {
        ...base,
        candidates: mergeAiCandidates(base.candidates, refined),
        providerUsed: provider,
        errors,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      errors.push(`${provider}: ${String(error)}`);
    }
  }

  return { ...base, errors };
}

function buildCandidateWindows(
  segments: Array<ScriptSegment & { endSec: number }>,
  settings: ShortExtractionSettings,
): CandidateWindow[] {
  const minDuration = settings.desiredDurationSec * (settings.allowOverrun ? 0.7 : 0.85);
  const maxDuration = settings.desiredDurationSec * (settings.allowOverrun ? 1.3 : 1.1);
  const windows: CandidateWindow[] = [];

  for (let startIndex = 0; startIndex < segments.length; startIndex += 1) {
    const collected: Array<ScriptSegment & { endSec: number }> = [];

    for (let index = startIndex; index < segments.length; index += 1) {
      collected.push(segments[index]);
      const startSec = collected[0].startSec;
      const endSec = collected[collected.length - 1].endSec;
      const durationSec = endSec - startSec;
      const endsCleanly = collected[collected.length - 1].sentenceComplete;

      if (durationSec >= minDuration && (endsCleanly || durationSec >= settings.desiredDurationSec)) {
        windows.push({
          segments: collected,
          startSec,
          endSec,
          durationSec,
          text: collected.map((segment) => segment.text).join(" "),
        });
      }

      if (durationSec >= maxDuration) {
        break;
      }
    }
  }

  return windows;
}

function buildCandidate(
  window: CandidateWindow,
  settings: ShortExtractionSettings,
  index: number,
  fullScriptContext: string,
): ShortCandidate {
  const scores = scoreWindow(window, settings);
  const keywords = extractKeywords(window.text, 5);
  const hookLine = firstSentence(window.text) || window.segments[0]?.text.trim() || "Strong short-form hook";
  const titleCore = toTitleCase(keywords.slice(0, 3).join(" ")) || platformLabel(settings.platform);
  const warnings = buildWarnings(window, scores, settings);
  const editNotes = buildEditNotes(window);
  const hasCtaOpportunity = scores.ctaOpportunity >= 0.45 || settings.includeCtaEnding;

  return {
    id: `short-${Math.round(window.startSec * 100)}-${Math.round(window.endSec * 100)}-${index + 1}`,
    titleSuggestion: `${titleCore}: ${trimToWords(hookLine, 8)}`,
    hookLine: trimToWords(hookLine, 18),
    startSec: round2(window.startSec),
    endSec: round2(window.endSec),
    durationSec: round2(window.durationSec),
    transcriptExcerpt: trimToWords(window.text, 90),
    platformFit: settings.platform,
    clipGoal: settings.clipGoal,
    scores,
    hasCtaOpportunity,
    reasonSelected: buildReason(scores, settings, keywords),
    suggestedCaptionStyle: settings.hookStyle === "emotional" ? "large emotional emphasis captions" : "clean bold captions with hook words highlighted",
    suggestedBrollStyle: keywords.length ? `Use proof-led visuals around ${keywords.slice(0, 3).join(", ")}.` : "Use tight face-time with simple proof inserts.",
    suggestedThumbnailText: trimToWords(hookLine, 5).toUpperCase(),
    suggestedTitle: `${trimToWords(hookLine, 10)} | ${platformLabel(settings.platform)}`,
    suggestedDescription: buildDescription(window.text, settings, fullScriptContext),
    suggestedHashtags: buildHashtags(settings.platform, keywords),
    segmentIds: window.segments.map((segment) => segment.id),
    warnings,
    editNotes,
  };
}

function scoreWindow(window: CandidateWindow, settings: ShortExtractionSettings): ShortCandidateScore {
  const firstText = window.segments.slice(0, 2).map((segment) => segment.text).join(" ").toLowerCase();
  const allText = window.text.toLowerCase();
  const lastText = window.segments.slice(-2).map((segment) => segment.text).join(" ").toLowerCase();
  const hookHits = countMatches(firstText, /\b(never|truth|most people|stop|your|you|secret|mistake|nobody|why|how)\b/g);
  const hook = clamp01(0.18 + hookHits * 0.16 + (/[?]/.test(firstText) ? 0.16 : 0) + hookStyleBonus(settings.hookStyle, firstText));
  const avgSegmentDuration = window.durationSec / Math.max(1, window.segments.length);
  const sweetSpot = 1 - Math.min(1, Math.abs(avgSegmentDuration - 4) / 5);
  const retention = clamp01(0.25 + sweetSpot * 0.45 + countMatches(allText, /\b\d+%?\b/g) * 0.08 + countMatches(allText, /\b(but|because|until|then|suddenly|instead)\b/g) * 0.04);
  const completionRatio = window.segments.filter((segment) => segment.sentenceComplete).length / Math.max(1, window.segments.length);
  const completeness = clamp01(completionRatio - (window.segments[0]?.sentenceComplete ? 0 : 0.12) - (window.segments[window.segments.length - 1]?.sentenceComplete ? 0 : 0.18));
  const controversy = clamp01(0.12 + countMatches(allText, /\b(is not|must|never|always|cage|weapon|currency|power|predictable|wrong|lie|broken)\b/g) * 0.12 + countMatches(allText, /!/g) * 0.05);
  const confidenceValues = window.segments.map((segment) => segment.sentenceBoundaryConfidence || 0.6);
  const clarity = clamp01(0.25 + average(confidenceValues) * 0.45 + countMatches(allText, /\b(is|are|means|creates|drives|shows|builds|turns)\b/g) * 0.025);
  const ctaOpportunity = clamp01(countMatches(lastText, /\b(follow|share|comment|subscribe|link|read|download|watch|join|buy|try)\b/g) * 0.2 + (settings.includeCtaEnding ? 0.2 : 0.05));
  const overall = weightedOverall({ hook, retention, completeness, controversy, clarity, ctaOpportunity, overall: 0 }, settings);

  return { hook, retention, completeness, controversy, clarity, ctaOpportunity, overall };
}

function weightedOverall(scores: ShortCandidateScore, settings: ShortExtractionSettings): number {
  const weights = {
    hook: 1.35,
    retention: settings.clipGoal === "retention" ? 1.8 : 1.25,
    completeness: 1.25,
    controversy: settings.clipGoal === "controversy" ? 1.7 : 0.75,
    clarity: settings.clipGoal === "education" || settings.clipGoal === "authority" ? 1.4 : 1,
    ctaOpportunity: settings.clipGoal === "leads" || settings.clipGoal === "sales" ? 1.45 : 0.65,
  };
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  return round2((
    scores.hook * weights.hook +
    scores.retention * weights.retention +
    scores.completeness * weights.completeness +
    scores.controversy * weights.controversy +
    scores.clarity * weights.clarity +
    scores.ctaOpportunity * weights.ctaOpportunity
  ) / total);
}

function buildWarnings(window: CandidateWindow, scores: ShortCandidateScore, settings: ShortExtractionSettings): ShortWarning[] {
  const warnings: ShortWarning[] = [];
  const opener = window.segments[0]?.text.toLowerCase() ?? "";
  const maxDuration = settings.desiredDurationSec * (settings.allowOverrun ? 1.3 : 1.1);
  const minDuration = settings.desiredDurationSec * (settings.allowOverrun ? 0.7 : 0.85);

  if (!window.segments[0]?.sentenceComplete) warnings.push("starts-mid-thought");
  if (!window.segments[window.segments.length - 1]?.sentenceComplete) warnings.push("ends-mid-thought");
  if (window.durationSec > maxDuration) warnings.push("too-long");
  if (window.durationSec < minDuration) warnings.push("too-short");
  if (scores.hook < 0.45) warnings.push("weak-hook");
  if (/(as i mentioned|like i said|that thing|this is why|he said|she said|they said|it was)/i.test(opener)) warnings.push("needs-context");
  if (/\b(kill|attack|destroy|hate|slur)\b/i.test(window.text)) warnings.push("unsafe-wording");

  return warnings;
}

function buildEditNotes(window: CandidateWindow): ShortCandidateEditNotes {
  const relative = (sec: number) => round2(Math.max(0, sec - window.startSec));
  const strongClaimSegments = window.segments.filter((segment) => /\b(never|always|must|wrong|truth|secret|power|stop)\b/i.test(segment.text));
  const nounHeavy = [...window.segments]
    .sort((left, right) => extractKeywords(right.text, 8).length - extractKeywords(left.text, 8).length)
    .slice(0, 3);

  return {
    punchInAtSec: uniqueNumbers([0, ...strongClaimSegments.map((segment) => relative(segment.startSec))]),
    brollAtSec: uniqueNumbers(nounHeavy.map((segment) => relative(segment.startSec))),
    captionsAtSec: uniqueNumbers(window.segments.filter((segment) => segment.sentenceComplete).map((segment) => relative(segment.endSec ?? segment.startSec))),
    soundHitsAtSec: uniqueNumbers([0, relative(window.segments[window.segments.length - 1]?.startSec ?? window.startSec)]),
    silenceCutsAtSec: uniqueNumbers(window.segments.flatMap((segment, index) => {
      const next = window.segments[index + 1];
      if (!next || segment.endSec === null || next.startSec - segment.endSec <= 0.4) {
        return [];
      }
      return [relative(segment.endSec)];
    })),
  };
}

function dedupeCandidates(candidates: ShortCandidate[], settings: ShortExtractionSettings): ShortCandidate[] {
  const kept: ShortCandidate[] = [];
  for (const candidate of candidates) {
    const overlaps = kept.some((existing) => overlapRatio(candidate, existing) > 0.45);
    const duplicateTopic = settings.avoidDuplicateTopics && kept.some((existing) => jaccard(extractKeywords(candidate.transcriptExcerpt, 20), extractKeywords(existing.transcriptExcerpt, 20)) >= 0.55);
    if (!overlaps && !duplicateTopic) {
      kept.push(candidate);
    }
  }
  return kept;
}

async function refineWithOllama(
  candidates: ShortCandidate[],
  settings: ShortExtractionSettings,
  context: AiScoringContext,
): Promise<AiShortsPayload> {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(context.ollamaBaseUrl)}/api/generate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: context.ollamaModel || "gemma4:e4b",
        prompt: buildAiPrompt(candidates, settings, context),
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
  return parseAiPayload(payload.response ?? "");
}

async function refineWithGemini(
  candidates: ShortCandidate[],
  settings: ShortExtractionSettings,
  context: AiScoringContext,
): Promise<AiShortsPayload> {
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${context.geminiModel}:generateContent?key=${context.geminiApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildAiPrompt(candidates, settings, context) }] }],
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
  return parseAiPayload(payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
}

function buildAiPrompt(candidates: ShortCandidate[], settings: ShortExtractionSettings, context: AiScoringContext): string {
  return [
    "You are reranking short-form clips from a transcript. Return strict JSON only.",
    "Keep id, startSec, endSec, durationSec, and segmentIds unchanged. Rewrite only titles, hooks, descriptions, hashtags, reasonSelected, suggestedCaptionStyle, suggestedBrollStyle, suggestedThumbnailText, and scores from 0 to 1.",
    'Shape: {"candidates":[{"id":"...","titleSuggestion":"...","hookLine":"...","reasonSelected":"...","suggestedCaptionStyle":"...","suggestedBrollStyle":"...","suggestedThumbnailText":"...","suggestedTitle":"...","suggestedDescription":"...","suggestedHashtags":["#tag"],"scores":{"hook":0.8,"retention":0.8,"completeness":0.8,"controversy":0.2,"clarity":0.8,"ctaOpportunity":0.4,"overall":0.75}}]}',
    `Settings: ${JSON.stringify(settings)}`,
    context.editGoal ? `Edit goal: ${context.editGoal}` : "",
    context.editStyle ? `Edit style: ${context.editStyle}` : "",
    context.brandNotes ? `Brand notes: ${context.brandNotes}` : "",
    context.customInstructions ? `Custom instructions: ${context.customInstructions}` : "",
    `Candidates: ${JSON.stringify(candidates.map((candidate) => ({
      id: candidate.id,
      startSec: candidate.startSec,
      endSec: candidate.endSec,
      durationSec: candidate.durationSec,
      transcriptExcerpt: candidate.transcriptExcerpt,
      scores: candidate.scores,
    })))}`,
  ].filter(Boolean).join("\n");
}

function mergeAiCandidates(base: ShortCandidate[], payload: AiShortsPayload): ShortCandidate[] {
  const byId = new Map((payload.candidates ?? []).map((candidate) => [candidate.id, candidate]));
  return base
    .map((candidate) => {
      const refined = byId.get(candidate.id);
      if (!refined) {
        return candidate;
      }
      const scores = normalizeScores({ ...candidate.scores, ...refined.scores });
      return {
        ...candidate,
        titleSuggestion: cleanText(refined.titleSuggestion) ?? candidate.titleSuggestion,
        hookLine: cleanText(refined.hookLine) ?? candidate.hookLine,
        reasonSelected: cleanText(refined.reasonSelected) ?? candidate.reasonSelected,
        suggestedCaptionStyle: cleanText(refined.suggestedCaptionStyle) ?? candidate.suggestedCaptionStyle,
        suggestedBrollStyle: cleanText(refined.suggestedBrollStyle) ?? candidate.suggestedBrollStyle,
        suggestedThumbnailText: cleanText(refined.suggestedThumbnailText) ?? candidate.suggestedThumbnailText,
        suggestedTitle: cleanText(refined.suggestedTitle) ?? candidate.suggestedTitle,
        suggestedDescription: cleanText(refined.suggestedDescription) ?? candidate.suggestedDescription,
        suggestedHashtags: Array.isArray(refined.suggestedHashtags) && refined.suggestedHashtags.length > 0
          ? refined.suggestedHashtags.map(String)
          : candidate.suggestedHashtags,
        scores,
      };
    })
    .sort((left, right) => right.scores.overall - left.scores.overall);
}

function normalizeScores(scores: Partial<ShortCandidateScore>): ShortCandidateScore {
  return {
    hook: clamp01(Number(scores.hook ?? 0)),
    retention: clamp01(Number(scores.retention ?? 0)),
    completeness: clamp01(Number(scores.completeness ?? 0)),
    controversy: clamp01(Number(scores.controversy ?? 0)),
    clarity: clamp01(Number(scores.clarity ?? 0)),
    ctaOpportunity: clamp01(Number(scores.ctaOpportunity ?? 0)),
    overall: clamp01(Number(scores.overall ?? 0)),
  };
}

function parseAiPayload(raw: string): AiShortsPayload {
  const parsed = safeJsonParse(extractJsonObject(raw)) as AiShortsPayload | null;
  if (!parsed || !Array.isArray(parsed.candidates)) {
    throw new Error("Invalid JSON shorts output");
  }
  return parsed;
}

function resolveEndSec(segment: ScriptSegment, next?: ScriptSegment): number | null {
  if (typeof segment.endSec === "number" && segment.endSec > segment.startSec) {
    return segment.endSec;
  }
  if (next && next.startSec > segment.startSec) {
    return next.startSec;
  }
  return null;
}

function hookStyleBonus(style: ShortExtractionSettings["hookStyle"], text: string): number {
  const styleMatchers: Record<ShortExtractionSettings["hookStyle"], RegExp> = {
    shocking: /\b(never|shocking|truth|wrong|stop)\b/,
    curiosity: /\b(why|how|secret|nobody|what if)\b/,
    value: /\b(learn|use|simple|framework|steps|system)\b/,
    emotional: /\b(felt|afraid|wanted|love|hate|lost|found)\b/,
    contrarian: /\b(not|wrong|instead|myth|lie)\b/,
    story: /\b(when|then|story|realized|before|after)\b/,
  };
  return styleMatchers[style].test(text) ? 0.12 : 0;
}

function buildReason(scores: ShortCandidateScore, settings: ShortExtractionSettings, keywords: string[]): string {
  const strongest = [
    ["hook", scores.hook],
    ["retention", scores.retention],
    ["completeness", scores.completeness],
    ["clarity", scores.clarity],
    ["CTA", scores.ctaOpportunity],
    ["edge", scores.controversy],
  ].sort((left, right) => Number(right[1]) - Number(left[1]))[0][0];
  return `Selected for ${strongest} strength against the ${settings.clipGoal} goal${keywords.length ? `, centered on ${keywords.slice(0, 3).join(", ")}` : ""}.`;
}

function buildDescription(text: string, settings: ShortExtractionSettings, fullScriptContext: string): string {
  const contextHint = fullScriptContext ? " Pulled from the strongest moment in the long-form transcript." : "";
  return `${trimToWords(text, 28)}${settings.includeCtaEnding ? " Follow for the next part." : ""}${contextHint}`;
}

function buildHashtags(platform: ShortPlatform, keywords: string[]): string[] {
  const platformTags: Record<ShortPlatform, string[]> = {
    "youtube-shorts": ["#shorts", "#youtube"],
    "instagram-reels": ["#reels", "#creator"],
    tiktok: ["#tiktok", "#learnontiktok"],
    linkedin: ["#leadership", "#business"],
  };
  return uniqueStrings([
    ...platformTags[platform],
    ...keywords.slice(0, 4).map((keyword) => `#${keyword.replace(/[^a-z0-9]/gi, "")}`),
  ]).slice(0, 8);
}

function extractKeywords(text: string, limit: number): string[] {
  const counts = new Map<string, number>();
  text.toLowerCase().split(/[^a-z0-9]+/).forEach((token) => {
    if (token.length < 4 || STOP_WORDS.has(token)) {
      return;
    }
    counts.set(token, (counts.get(token) ?? 0) + 1);
  });
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([token]) => token)
    .slice(0, limit);
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function firstSentence(text: string): string {
  return text.match(/[^.!?]+[.!?]/)?.[0]?.trim() ?? text.trim();
}

function trimToWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length > maxWords ? `${words.slice(0, maxWords).join(" ")}...` : words.join(" ");
}

function toTitleCase(text: string): string {
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function platformLabel(platform: ShortPlatform): string {
  return platform.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function overlapRatio(left: ShortCandidate, right: ShortCandidate): number {
  const overlap = Math.max(0, Math.min(left.endSec, right.endSec) - Math.max(left.startSec, right.startSec));
  return overlap / Math.max(1, Math.min(left.durationSec, right.durationSec));
}

function jaccard(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union > 0 ? intersection / union : 0;
}

function average(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter(Number.isFinite).map(round2))].sort((left, right) => left - right);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return round2(Math.max(0, Math.min(1, value)));
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
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
