import { GeminiAiProvider } from "./gemini";
import { OllamaAiProvider } from "./ollama";
import { AiProvider, clampScore, sanitizeCandidates } from "./provider";
import {
  AiBatchResult,
  AiHealthStatus,
  AiMode,
  AiRankedAsset,
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
  onSegmentProgress?: (segmentIndex: number, segmentTotal: number) => void,
): Promise<AiBatchResult> {
  if (mode === "off" || requests.length === 0) {
    return { rankingsBySegmentId: {}, providersUsed: [], errors: [] };
  }

  const rankingsBySegmentId: Record<string, AiSegmentRanking> = {};
  const providersUsed = new Set<string>();
  const errors: string[] = [];

  const providerOrder = resolveProviderOrder(mode, context);
  const preparedRequests = sanitizeCandidates(requests, 20);
  const segmentTotal = preparedRequests.length;

  for (let segmentIndex = 0; segmentIndex < preparedRequests.length; segmentIndex += 1) {
    const request = preparedRequests[segmentIndex];
    onSegmentProgress?.(segmentIndex + 1, segmentTotal);
    const providerResults = await Promise.all(
      providerOrder.map(async (provider) => {
        try {
          const providerProfile = provider.getModelProfile(context);
          const requestWithProfile = {
            ...request,
            candidates: request.candidates.slice(0, providerProfile.maxCandidatesPerSegment),
          };
          const ranking = await provider.rankAssetsForSegment(requestWithProfile, context);
          return { ranking };
        } catch (error) {
          return { error: `${provider.providerName}:${request.segmentId}: ${String(error)}` };
        }
      }),
    );

    const successfulRankings = providerResults
      .flatMap((result) => (result.ranking ? [result.ranking] : []));
    providerResults.forEach((result) => {
      if (result.error) {
        errors.push(result.error);
      }
    });

    const heuristicRanking = buildHeuristicRanking(request);
    const resolvedRanking = aggregateRankings(request, [...successfulRankings, heuristicRanking]);
    rankingsBySegmentId[request.segmentId] = resolvedRanking;
    resolvedRanking.provider.split("+").forEach((providerName) => providersUsed.add(providerName));
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

  const checks = resolveProviderOrder(mode, context).map((provider) => provider.healthCheck(context));
  return Promise.all(checks);
}

function resolveProviderOrder(mode: AiMode, context: AiScoringContext): AiProvider[] {
  if (mode === "local") {
    return [ollamaProvider];
  }

  if (mode === "hybrid") {
    return context.geminiApiKey ? [ollamaProvider, geminiProvider] : [ollamaProvider];
  }

  return [];
}

function buildHeuristicRanking(request: AiSegmentRequest): AiSegmentRanking {
  const textTokens = tokenize(request.text);
  const rankedAssets = request.candidates
    .map<AiRankedAsset>((candidate) => {
      const nameTokens = tokenize(candidate.name);
      const descriptorTokens = tokenize(candidate.descriptor ?? "");
      const overlapScore = scoreTokenOverlap(textTokens, new Set([...nameTokens, ...descriptorTokens]));
      const visualBonus = candidate.visualPaths?.length ? 0.08 : 0;
      const durationBonus = candidate.durationSec && request.endSec
        ? Math.max(0, 0.08 - Math.abs(candidate.durationSec - (request.endSec - request.startSec)) * 0.01)
        : 0;
      const score = clampScore(0.18 + overlapScore + visualBonus + durationBonus);

      return {
        candidateId: candidate.id,
        score,
        rationale: score > 0.35
          ? "Heuristic reviewer matched script words, asset metadata, and available visual samples."
          : "Heuristic reviewer kept this as a low-confidence coverage option.",
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, request.maxRecommendations ?? 6);

  const suggestedClipCount = estimateClipCount(request);

  return {
    provider: "heuristic",
    segmentId: request.segmentId,
    confidence: rankedAssets[0]?.score ?? 0,
    rationale: "Deterministic reviewer scored metadata, text overlap, duration, and coverage density.",
    rankedAssets,
    fallbackUsed: true,
    suggestedDurationSec: estimateDuration(request),
    suggestedLayerCount: request.allowOverlap && (request.wordCount ?? 0) > 22 ? Math.min(request.maxOverlapLayers ?? 2, 2) : 1,
    suggestedClipCount,
    overlapStyle: suggestedClipCount > 1 ? "staggered" : "single",
    timingRationale: "Heuristic timing uses transcript density and configured duration bounds.",
    coverageNotes: "Heuristic reviewer estimated sequential clip coverage from word count and sentence count.",
    reviewerNotes: ["heuristic: metadata and transcript density reviewer"],
  };
}

function aggregateRankings(request: AiSegmentRequest, rankings: AiSegmentRanking[]): AiSegmentRanking {
  const scoresByCandidate = new Map<string, { total: number; weight: number; rationales: string[] }>();

  rankings.forEach((ranking) => {
    const weight = ranking.provider === "heuristic" ? 0.65 : 1;
    ranking.rankedAssets.forEach((asset, rankIndex) => {
      const existing = scoresByCandidate.get(asset.candidateId) ?? { total: 0, weight: 0, rationales: [] };
      const rankBonus = Math.max(0, 0.04 - rankIndex * 0.01);
      existing.total += clampScore(asset.score + rankBonus) * weight;
      existing.weight += weight;
      if (asset.rationale) {
        existing.rationales.push(`${ranking.provider}: ${asset.rationale}`);
      }
      scoresByCandidate.set(asset.candidateId, existing);
    });
  });

  const rankedAssets = Array.from(scoresByCandidate.entries())
    .map<AiRankedAsset>(([candidateId, score]) => ({
      candidateId,
      score: clampScore(score.weight > 0 ? score.total / score.weight : 0),
      rationale: score.rationales.slice(0, 2).join(" | ") || "Aggregated by timeline agent reviewers.",
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, request.maxRecommendations ?? 6);

  const topScore = rankedAssets[0]?.score ?? 0;
  const providerNames = rankings.map((ranking) => ranking.provider);

  return {
    provider: providerNames.join("+"),
    segmentId: request.segmentId,
    confidence: topScore,
    rationale: `Timeline agent combined ${providerNames.join(", ")} reviewers for asset fit and coverage.`,
    rankedAssets,
    fallbackUsed: rankings.every((ranking) => ranking.fallbackUsed),
    suggestedDurationSec: estimateDuration(request),
    suggestedLayerCount: clampLayerCount(
      averageNumeric(rankings.map((ranking) => ranking.suggestedLayerCount)) ?? 1,
      request,
    ),
    suggestedClipCount: estimateClipCount(request),
    overlapStyle: chooseOverlapStyle(rankings),
    timingRationale: rankings
      .map((ranking) => ranking.timingRationale)
      .filter(Boolean)
      .slice(0, 2)
      .join(" | ") || "Timing uses deterministic transcript coverage; AI timing stays advisory.",
    coverageNotes: rankings
      .map((ranking) => ranking.coverageNotes)
      .filter(Boolean)
      .slice(0, 2)
      .join(" | ") || "Coverage estimated from transcript density and reviewer agreement.",
    reviewerNotes: rankings.map((ranking) => `${ranking.provider}: ${ranking.rationale}`),
    lowConfidenceReason:
      topScore < 0.55 ? "Reviewer agreement is below the editorial confidence threshold; placement should be reviewed." : undefined,
  };
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function scoreTokenOverlap(textTokens: string[], assetTokens: Set<string>): number {
  if (textTokens.length === 0 || assetTokens.size === 0) {
    return 0;
  }

  const matches = textTokens.filter((token) => assetTokens.has(token)).length;
  return Math.min(0.62, matches / Math.max(4, textTokens.length));
}

function estimateDuration(request: AiSegmentRequest): number {
  const min = request.minDurationSec ?? 0.5;
  const max = request.maxDurationSec ?? 8;
  const explicitDuration = request.endSec && request.endSec > request.startSec ? request.endSec - request.startSec : null;
  const cadenceDuration = Math.max(1.25, (request.wordCount ?? 8) / 2.6);
  return Math.max(min, Math.min(max, explicitDuration ?? cadenceDuration));
}

function estimateClipCount(request: AiSegmentRequest): number {
  const duration = estimateDuration(request);
  const durationDriven = Math.ceil(duration / 5.5);
  const wordDriven = Math.ceil((request.wordCount ?? 0) / 18);
  const sentenceDriven = Math.max(1, request.sentenceCount ?? 1);
  const incompleteBoost = !request.sentenceComplete && (request.wordCount ?? 0) > 16 ? 1 : 0;
  return clampClipCount(Math.max(durationDriven, wordDriven, sentenceDriven + incompleteBoost));
}

function clampClipCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.min(4, Math.round(value)));
}

function clampLayerCount(value: number, request: AiSegmentRequest): number {
  if (!request.allowOverlap) {
    return 1;
  }

  return Math.max(1, Math.min(request.maxOverlapLayers ?? 2, Math.round(value)));
}

function averageNumeric(values: Array<number | undefined>): number | null {
  const numericValues = values.filter((value): value is number => Number.isFinite(value));
  if (numericValues.length === 0) {
    return null;
  }

  return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
}

function chooseOverlapStyle(rankings: AiSegmentRanking[]): AiSegmentRanking["overlapStyle"] {
  if (rankings.some((ranking) => ranking.overlapStyle === "parallel")) {
    return "parallel";
  }

  if (rankings.some((ranking) => ranking.overlapStyle === "staggered")) {
    return "staggered";
  }

  return "single";
}
