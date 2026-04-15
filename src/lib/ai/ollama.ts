import { AiProvider, clampScore } from "./provider";
import { AiHealthStatus, AiModelProfile, AiScoringContext, AiSegmentRanking, AiSegmentRequest } from "./types";

interface OllamaTagResponse {
  models?: Array<{ name: string }>;
}

interface OllamaGenerateResponse {
  response?: string;
}

const DEFAULT_TIMEOUT_MS = 15000;

export class OllamaAiProvider implements AiProvider {
  providerName = "ollama";

  getModelProfile(context: AiScoringContext): AiModelProfile {
    return {
      provider: this.providerName,
      model: context.ollamaModel || "gemma4:e4b",
      maxCandidatesPerSegment: 15,
      maxSegmentsPerBatch: 20,
    };
  }

  async healthCheck(context: AiScoringContext): Promise<AiHealthStatus> {
    const startedAt = Date.now();
    const timeoutMs = context.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    try {
      const response = await fetchWithTimeout(`${normalizeBaseUrl(context.ollamaBaseUrl)}/api/tags`, {
        method: "GET",
      }, timeoutMs);
      const payload = (await response.json()) as OllamaTagResponse;
      const modelName = context.ollamaModel;
      const hasModel = Boolean(payload.models?.some((entry) => entry.name?.includes(modelName)));

      return {
        provider: this.providerName,
        ok: response.ok && hasModel,
        message: response.ok
          ? hasModel
            ? `Ollama reachable with model ${modelName}.`
            : `Ollama reachable but ${modelName} is missing.`
          : `Ollama HTTP ${response.status}.`,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        provider: this.providerName,
        ok: false,
        message: `Ollama unavailable: ${String(error)}`,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  async rankAssetsForSegment(
    request: AiSegmentRequest,
    context: AiScoringContext,
  ): Promise<AiSegmentRanking> {
    const prompt = createRankingPrompt(request);
    const timeoutMs = context.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let responseText = "";

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await fetchWithTimeout(
          `${normalizeBaseUrl(context.ollamaBaseUrl)}/api/generate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: context.ollamaModel,
              prompt,
              stream: false,
              options: {
                temperature: 0.1,
              },
            }),
          },
          timeoutMs,
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = (await response.json()) as OllamaGenerateResponse;
        responseText = payload.response ?? "";
        break;
      } catch (error) {
        if (attempt >= 2) {
          throw error;
        }
      }
    }

    const parsed = parseRankingResponse(responseText, request);

    return {
      provider: this.providerName,
      segmentId: request.segmentId,
      confidence: clampScore(parsed.confidence),
      rationale: parsed.rationale,
      rankedAssets: parsed.rankedAssets,
      fallbackUsed: false,
    };
  }
}

function createRankingPrompt(request: AiSegmentRequest): string {
  const candidateLines = request.candidates
    .map((candidate, index) => `${index + 1}. id=${candidate.id} | name=${candidate.name}`)
    .join("\n");

  return [
    "You are ranking visual assets for a video edit segment.",
    "Return strict JSON only with shape:",
    '{"confidence":0.0,"rationale":"short sentence","ranked":[{"candidateId":"...","score":0.0,"rationale":"..."}]}',
    `Choose up to ${request.maxRecommendations ?? 3} candidates.`,
    "Scores must be 0..1 and sorted descending.",
    `Segment text: "${request.text}"`,
    "Candidates:",
    candidateLines,
  ].join("\n");
}

function parseRankingResponse(
  raw: string,
  request: AiSegmentRequest,
): Pick<AiSegmentRanking, "confidence" | "rationale" | "rankedAssets"> {
  const parsed = safeJsonParse(extractJsonObject(raw)) as
    | {
        confidence?: number;
        rationale?: string;
        ranked?: Array<{ candidateId?: string; score?: number; rationale?: string }>;
      }
    | null;

  if (!parsed || !Array.isArray(parsed.ranked)) {
    return {
      confidence: 0,
      rationale: "Model response could not be parsed; deterministic fallback remains available.",
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
    rationale: String(parsed.rationale ?? "Ranked by local semantic relevance."),
    rankedAssets,
  };
}

function extractJsonObject(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return "{}";
  }

  return raw.slice(start, end + 1);
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeBaseUrl(value: string): string {
  return (value || "http://127.0.0.1:11434").replace(/\/+$/, "");
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
