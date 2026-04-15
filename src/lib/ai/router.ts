import { GeminiAiProvider } from "./gemini";
import { OllamaAiProvider } from "./ollama";
import { AiProvider, sanitizeCandidates } from "./provider";
import {
  AiBatchResult,
  AiHealthStatus,
  AiMode,
  AiScoringContext,
  AiSegmentRanking,
  AiSegmentRequest,
} from "./types";

const ollamaProvider = new OllamaAiProvider();
const geminiProvider = new GeminiAiProvider();

export async function rankSegmentsWithAi(
  requests: AiSegmentRequest[],
  mode: AiMode,
  context: AiScoringContext,
): Promise<AiBatchResult> {
  if (mode === "off" || requests.length === 0) {
    return { rankingsBySegmentId: {}, providersUsed: [], errors: [] };
  }

  const rankingsBySegmentId: Record<string, AiSegmentRanking> = {};
  const providersUsed = new Set<string>();
  const errors: string[] = [];

  const providerOrder = resolveProviderOrder(mode);
  const preparedRequests = sanitizeCandidates(requests, 15);

  for (const request of preparedRequests) {
    let resolvedRanking: AiSegmentRanking | null = null;

    for (const provider of providerOrder) {
      try {
        const providerProfile = provider.getModelProfile(context);
        const requestWithProfile = {
          ...request,
          candidates: request.candidates.slice(0, providerProfile.maxCandidatesPerSegment),
        };
        const ranking = await provider.rankAssetsForSegment(requestWithProfile, context);
        rankingsBySegmentId[request.segmentId] = ranking;
        providersUsed.add(provider.providerName);
        resolvedRanking = ranking;
        break;
      } catch (error) {
        errors.push(`${provider.providerName}:${request.segmentId}: ${String(error)}`);
      }
    }

    if (!resolvedRanking) {
      rankingsBySegmentId[request.segmentId] = {
        provider: "none",
        segmentId: request.segmentId,
        confidence: 0,
        rationale: "All AI providers failed. Deterministic fallback stays active.",
        rankedAssets: [],
        fallbackUsed: true,
      };
    }
  }

  return {
    rankingsBySegmentId,
    providersUsed: Array.from(providersUsed),
    errors,
  };
}

export async function checkAiProviders(
  mode: AiMode,
  context: AiScoringContext,
): Promise<AiHealthStatus[]> {
  if (mode === "off") {
    return [];
  }

  const checks = resolveProviderOrder(mode).map((provider) => provider.healthCheck(context));
  return Promise.all(checks);
}

function resolveProviderOrder(mode: AiMode): AiProvider[] {
  if (mode === "local") {
    return [ollamaProvider];
  }

  if (mode === "hybrid") {
    return [ollamaProvider, geminiProvider];
  }

  return [];
}
