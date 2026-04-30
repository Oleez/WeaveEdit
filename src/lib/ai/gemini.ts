import { AiProvider, clampScore } from "./provider";
import {
  AiAssetCandidate,
  AiHealthStatus,
  AiModelProfile,
  AiScoringContext,
  AiSegmentRanking,
  AiSegmentRequest,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15000;

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

export class GeminiAiProvider implements AiProvider {
  providerName = "gemini";

  getModelProfile(context: AiScoringContext): AiModelProfile {
    return {
      provider: this.providerName,
      model: context.geminiModel || "gemma-4-26b-a4b-it",
      maxCandidatesPerSegment: 10,
      maxSegmentsPerBatch: 15,
    };
  }

  async healthCheck(context: AiScoringContext): Promise<AiHealthStatus> {
    const startedAt = Date.now();

    if (!context.geminiApiKey) {
      return {
        provider: this.providerName,
        ok: false,
        message: "Missing GEMINI_API_KEY; fallback disabled.",
        latencyMs: Date.now() - startedAt,
      };
    }

    try {
      await this.generate(context, [{ text: "Respond with the word OK." }]);
      return {
        provider: this.providerName,
        ok: true,
        message: `Gemini API reachable with model ${context.geminiModel}.`,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        provider: this.providerName,
        ok: false,
        message: `Gemini unavailable: ${String(error)}`,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  async rankAssetsForSegment(
    request: AiSegmentRequest,
    context: AiScoringContext,
  ): Promise<AiSegmentRanking> {
    if (!context.geminiApiKey) {
      throw new Error("Missing GEMINI_API_KEY in environment.");
    }

    const rankedAssets: AiSegmentRanking["rankedAssets"] = [];
    for (const candidate of request.candidates) {
      const scored = await this.scoreCandidate(candidate, request, context);
      rankedAssets.push(scored);
    }

    rankedAssets.sort((left, right) => right.score - left.score);
    const editPlan = await this.suggestEditPlan(request, rankedAssets, context);

    return {
      provider: this.providerName,
      segmentId: request.segmentId,
      confidence: clampScore(rankedAssets[0]?.score ?? 0),
      rationale:
        rankedAssets[0]?.rationale ??
        "Ranked by Gemini multimodal fallback using transcript and visual samples.",
      rankedAssets: rankedAssets.slice(0, request.maxRecommendations ?? 3),
      fallbackUsed: false,
      suggestedDurationSec: editPlan.suggestedDurationSec,
      suggestedLayerCount: editPlan.suggestedLayerCount,
      suggestedClipCount: editPlan.suggestedClipCount,
      overlapStyle: editPlan.overlapStyle,
      timingRationale: editPlan.rationale,
      coverageNotes: editPlan.coverageNotes,
      lowConfidenceReason:
        (rankedAssets[0]?.score ?? 0) < 0.55
          ? "AI confidence is below the editorial threshold, so placement should be reviewed."
          : undefined,
    };
  }

  private async scoreCandidate(
    candidate: AiAssetCandidate,
    request: AiSegmentRequest,
    context: AiScoringContext,
  ): Promise<AiSegmentRanking["rankedAssets"][number]> {
    const parts: GeminiPart[] = [{ text: createCandidatePrompt(request, candidate) }, ...createInlineImageParts(candidate)];
    const text = await this.generate(context, parts);
    const parsed = parseCandidateResponse(text);

    return {
      candidateId: candidate.id,
      score: clampScore(parsed.score),
      rationale: parsed.rationale,
    };
  }

  private async suggestEditPlan(
    request: AiSegmentRequest,
    rankedAssets: AiSegmentRanking["rankedAssets"],
    context: AiScoringContext,
  ) {
    const text = await this.generate(context, [
      {
        text: createEditPlanPrompt(request, rankedAssets),
      },
    ]);
    const parsed = parseEditPlanResponse(text, request);
    return parsed;
  }

  private async generate(context: AiScoringContext, parts: GeminiPart[]): Promise<string> {
    const timeoutMs = context.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${context.geminiModel}:generateContent?key=${context.geminiApiKey}`;
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        }),
      },
      timeoutMs,
    );

    if (!response.ok) {
      throw new Error(`Gemini HTTP ${response.status}`);
    }

    const payload = (await response.json()) as GeminiGenerateResponse;
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error("Gemini response missing text.");
    }

    return text;
  }
}

interface GeminiPart {
  text?: string;
  inline_data?: {
    mime_type: string;
    data: string;
  };
}

function createCandidatePrompt(request: AiSegmentRequest, candidate: AiAssetCandidate): string {
  return [
    "You are scoring one visual asset for one script segment in a Premiere editing workflow.",
    'Return strict JSON only with shape: {"score":0.0,"rationale":"short sentence"}',
    `Segment text: "${request.text}"`,
    `Segment timing: start=${request.startSec.toFixed(2)} end=${request.endSec ?? "unknown"}`,
    `Candidate id: ${candidate.id}`,
    `Candidate name: ${candidate.name}`,
    `Candidate type: ${candidate.mediaType}`,
    `Candidate descriptor: ${candidate.descriptor ?? candidate.name}`,
    request.customInstructions ? `Custom instructions: ${request.customInstructions}` : "",
    candidate.durationSec ? `Candidate duration: ${candidate.durationSec.toFixed(2)} seconds` : "",
    candidate.sampleTimestampsSec?.length
      ? `Candidate sample timestamps: ${candidate.sampleTimestampsSec.map((value) => value.toFixed(2)).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function createEditPlanPrompt(
  request: AiSegmentRequest,
  rankedAssets: AiSegmentRanking["rankedAssets"],
): string {
  return [
    "You are deciding editorial timing for one transcript segment.",
    'Return strict JSON only with shape: {"suggestedDurationSec":0.0,"suggestedLayerCount":1,"suggestedClipCount":1,"overlapStyle":"single","coverageNotes":"short sentence","rationale":"short sentence"}',
    `Segment text: "${request.text}"`,
    `Sentence complete: ${request.sentenceComplete ? "yes" : "no"}`,
    `Word count: ${request.wordCount ?? 0}`,
    `Sentence count: ${request.sentenceCount ?? 0}`,
    `Safety min duration: ${request.minDurationSec ?? 0.5}`,
    `Safety max duration: ${request.maxDurationSec ?? 8}`,
    `Allow overlap: ${request.allowOverlap ? "yes" : "no"}`,
    `Max overlap layers: ${request.maxOverlapLayers ?? 1}`,
    request.customInstructions ? `Custom instructions: ${request.customInstructions}` : "",
    `Top candidate scores: ${rankedAssets
      .slice(0, 3)
      .map((asset) => `${asset.candidateId}=${asset.score.toFixed(2)}`)
      .join(", ")}`,
    "Suggested clip count decides how many sequential visuals should cover this segment on the same track.",
    "Use 1 clip for a short/simple thought, 2 clips for long or two-part narration, and 3-4 clips for dense multi-clause narration.",
    "Use layer count only for simultaneous overlays, not for sequential coverage.",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseCandidateResponse(
  raw: string,
): { score: number; rationale: string } {
  const parsed = safeJsonParse(extractJsonObject(raw)) as
    | {
        score?: number;
        rationale?: string;
      }
    | null;

  if (!parsed) {
    return {
      score: 0,
      rationale: "Gemini response could not be parsed; deterministic fallback remains available.",
    };
  }

  return {
    score: Number(parsed.score ?? 0),
    rationale: String(parsed.rationale ?? "Ranked by Gemini fallback."),
  };
}

function parseEditPlanResponse(
  raw: string,
  request: AiSegmentRequest,
): {
  suggestedDurationSec: number;
  suggestedLayerCount: number;
  suggestedClipCount: number;
  overlapStyle: "single" | "parallel" | "staggered";
  coverageNotes: string;
  rationale: string;
} {
  const parsed = safeJsonParse(extractJsonObject(raw)) as
    | {
        suggestedDurationSec?: number;
        suggestedLayerCount?: number;
        suggestedClipCount?: number;
        overlapStyle?: "single" | "parallel" | "staggered";
        coverageNotes?: string;
        rationale?: string;
      }
    | null;

  const min = request.minDurationSec ?? 0.5;
  const max = request.maxDurationSec ?? 8;
  const defaultDuration = Math.max(min, Math.min(max, Math.max(1.25, (request.wordCount ?? 8) / 2.6)));
  const requestedLayers = request.allowOverlap ? Math.max(1, request.maxOverlapLayers ?? 2) : 1;

  return {
    suggestedDurationSec: parsed?.suggestedDurationSec
      ? Math.max(min, Math.min(max, parsed.suggestedDurationSec))
      : defaultDuration,
    suggestedLayerCount: request.allowOverlap
      ? Math.max(1, Math.min(requestedLayers, Math.round(parsed?.suggestedLayerCount ?? 1)))
      : 1,
    suggestedClipCount: clampClipCount(parsed?.suggestedClipCount, request),
    overlapStyle:
      request.allowOverlap && (parsed?.overlapStyle === "parallel" || parsed?.overlapStyle === "staggered")
        ? parsed.overlapStyle
        : "single",
    coverageNotes: String(parsed?.coverageNotes ?? "Sequential clip count derived from transcript density."),
    rationale: String(parsed?.rationale ?? "Timing aligned to transcript cadence."),
  };
}

function clampClipCount(value: number | undefined, request: AiSegmentRequest): number {
  const heuristic = Math.max(
    Math.ceil((request.wordCount ?? 0) / 18),
    Math.ceil(((request.maxDurationSec ?? 8) || 1) / 5.5),
    request.sentenceCount ?? 1,
  );
  const parsed = Number(value ?? heuristic);
  if (!Number.isFinite(parsed)) {
    return Math.max(1, Math.min(4, heuristic));
  }

  return Math.max(1, Math.min(4, Math.round(parsed)));
}

function extractJsonObject(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return "{}";
  }

  return raw.slice(start, end + 1);
}

function createInlineImageParts(candidate: AiAssetCandidate): GeminiPart[] {
  if (!candidate.visualPaths?.length || typeof window.require !== "function") {
    return [];
  }

  const nodeRequire = window.require as (moduleName: string) => unknown;
  const fs = nodeRequire("fs") as { readFileSync: (path: string, encoding: string) => string };

  return candidate.visualPaths.slice(0, 3).map((filePath) => ({
    inline_data: {
      mime_type: inferImageMimeType(filePath),
      data: fs.readFileSync(filePath, "base64"),
    },
  }));
}

function inferImageMimeType(filePath: string): string {
  const normalized = filePath.toLowerCase();
  if (normalized.endsWith(".png")) {
    return "image/png";
  }
  if (normalized.endsWith(".webp")) {
    return "image/webp";
  }
  if (normalized.endsWith(".gif")) {
    return "image/gif";
  }

  return "image/jpeg";
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}
