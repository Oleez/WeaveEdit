import { AiProvider, clampScore } from "./provider";
import {
  AiAssetCandidate,
  AiHealthStatus,
  AiModelProfile,
  AiScoringContext,
  AiSegmentRanking,
  AiSegmentRequest,
} from "./types";

interface OllamaTagResponse {
  models?: Array<{ name: string }>;
}

interface OllamaGenerateResponse {
  response?: string;
}

interface NodeRequire {
  (moduleName: string): unknown;
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
    const timeoutMs = context.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const rankedAssets: AiSegmentRanking["rankedAssets"] = [];

    for (const candidate of request.candidates) {
      const scored = await scoreCandidate(candidate, request, context, timeoutMs);
      rankedAssets.push(scored);
    }

    rankedAssets.sort((left, right) => right.score - left.score);
    const topScore = rankedAssets[0]?.score ?? 0;

    return {
      provider: this.providerName,
      segmentId: request.segmentId,
      confidence: clampScore(topScore),
      rationale:
        rankedAssets[0]?.rationale ??
        "Ranked by local Gemma analysis using filenames, timestamps, and extracted visual samples when available.",
      rankedAssets: rankedAssets.slice(0, request.maxRecommendations ?? 3),
      fallbackUsed: false,
    };
  }
}

async function scoreCandidate(
  candidate: AiAssetCandidate,
  request: AiSegmentRequest,
  context: AiScoringContext,
  timeoutMs: number,
): Promise<AiSegmentRanking["rankedAssets"][number]> {
  const prompt = createCandidatePrompt(request, candidate);
  const images = readVisualInputs(candidate.visualPaths);
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
            images,
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

  const parsed = parseCandidateResponse(responseText);
  return {
    candidateId: candidate.id,
    score: clampScore(parsed.score),
    rationale: parsed.rationale,
  };
}

function createCandidatePrompt(request: AiSegmentRequest, candidate: AiAssetCandidate): string {
  return [
    "You are scoring one visual asset for one script segment in a Premiere editing workflow.",
    "Use the script meaning, timing, and any attached image frames.",
    'Return strict JSON only with shape: {"score":0.0,"rationale":"short sentence"}',
    `Segment text: "${request.text}"`,
    `Segment timing: start=${request.startSec.toFixed(2)} end=${request.endSec ?? "unknown"}`,
    `Candidate id: ${candidate.id}`,
    `Candidate name: ${candidate.name}`,
    `Candidate type: ${candidate.mediaType}`,
    `Candidate descriptor: ${candidate.descriptor ?? candidate.name}`,
    candidate.durationSec ? `Candidate duration: ${candidate.durationSec.toFixed(2)} seconds` : "",
    candidate.sampleTimestampsSec?.length
      ? `Candidate sample timestamps: ${candidate.sampleTimestampsSec.map((value) => value.toFixed(2)).join(", ")}`
      : "",
    "Score guidelines:",
    "1.0 = excellent semantic and visual fit, 0.0 = unrelated.",
    "Prefer assets whose meaning and mood match the segment text.",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseCandidateResponse(raw: string): { score: number; rationale: string } {
  const parsed = safeJsonParse(extractJsonObject(raw)) as
    | {
        score?: number;
        rationale?: string;
      }
    | null;

  if (!parsed) {
    return {
      score: 0,
      rationale: "Model response could not be parsed; deterministic fallback remains available.",
    };
  }

  return {
    score: Number(parsed.score ?? 0),
    rationale: String(parsed.rationale ?? "Relevant to script context."),
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

function readVisualInputs(paths: string[] | undefined): string[] {
  if (!paths?.length || typeof window.require !== "function") {
    return [];
  }

  const nodeRequire = window.require as NodeRequire;
  const fs = nodeRequire("fs") as { readFileSync: (path: string, encoding: string) => string };

  return paths.slice(0, 3).map((filePath) => fs.readFileSync(filePath, "base64"));
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
