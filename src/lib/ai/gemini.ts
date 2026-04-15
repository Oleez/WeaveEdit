import { AiProvider, clampScore } from "./provider";
import { AiHealthStatus, AiModelProfile, AiScoringContext, AiSegmentRanking, AiSegmentRequest } from "./types";

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
      await this.generate(context, "Respond with the word OK.");
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

    const prompt = createPrompt(request);
    const text = await this.generate(context, prompt);
    const parsed = parseResponse(text, request);

    return {
      provider: this.providerName,
      segmentId: request.segmentId,
      confidence: clampScore(parsed.confidence),
      rationale: parsed.rationale,
      rankedAssets: parsed.rankedAssets,
      fallbackUsed: false,
    };
  }

  private async generate(context: AiScoringContext, prompt: string): Promise<string> {
    const timeoutMs = context.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${context.geminiModel}:generateContent?key=${context.geminiApiKey}`;
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
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

function createPrompt(request: AiSegmentRequest): string {
  return JSON.stringify({
    task: "Rank visual assets for one script segment.",
    output: {
      confidence: "0..1",
      rationale: "one sentence",
      ranked: [
        {
          candidateId: "string",
          score: "0..1",
          rationale: "short",
        },
      ],
    },
    maxRecommendations: request.maxRecommendations ?? 3,
    segment: {
      id: request.segmentId,
      text: request.text,
      startSec: request.startSec,
      endSec: request.endSec,
    },
    candidates: request.candidates,
  });
}

function parseResponse(
  raw: string,
  request: AiSegmentRequest,
): Pick<AiSegmentRanking, "confidence" | "rationale" | "rankedAssets"> {
  const parsed = safeJsonParse(raw) as
    | {
        confidence?: number;
        rationale?: string;
        ranked?: Array<{ candidateId?: string; score?: number; rationale?: string }>;
      }
    | null;

  if (!parsed || !Array.isArray(parsed.ranked)) {
    return {
      confidence: 0,
      rationale: "Gemini response could not be parsed; deterministic fallback remains available.",
      rankedAssets: [],
    };
  }

  const validCandidateIds = new Set(request.candidates.map((candidate) => candidate.id));
  const rankedAssets = parsed.ranked
    .filter((item) => item.candidateId && validCandidateIds.has(item.candidateId))
    .map((item) => ({
      candidateId: String(item.candidateId),
      score: clampScore(Number(item.score ?? 0)),
      rationale: String(item.rationale ?? "Relevant to script context."),
    }))
    .sort((left, right) => right.score - left.score);

  return {
    confidence: clampScore(Number(parsed.confidence ?? rankedAssets[0]?.score ?? 0)),
    rationale: String(parsed.rationale ?? "Ranked by Gemini fallback."),
    rankedAssets,
  };
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
