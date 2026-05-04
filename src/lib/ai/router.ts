import { GeminiAiProvider } from "./gemini";
import { OllamaAiProvider } from "./ollama";
import { AiProvider, clampScore, sanitizeCandidates } from "./provider";
import {
  AiBatchResult,
  AiHealthStatus,
  AiMode,
  AiRankedAsset,
  AiAssetCandidate,
  AiScoringContext,
  AiSegmentRanking,
  AiSegmentRequest,
  AssetSemanticProfile,
} from "./types";
import { createFallbackAssetProfile } from "./dynamic-editor";

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

    const heuristicRanking = buildHeuristicRanking(request, context);
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

export async function profileAssetsWithAi(
  candidates: AiAssetCandidate[],
  mode: AiMode,
  context: AiScoringContext,
  onAssetProgress?: (assetIndex: number, assetTotal: number) => void,
): Promise<{ profiles: AssetSemanticProfile[]; providersUsed: string[]; errors: string[] }> {
  const providers = resolveProviderOrder(mode, context).filter((provider) => provider.profileAsset);
  const providersUsed = new Set<string>();
  const errors: string[] = [];
  const profiles: AssetSemanticProfile[] = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    onAssetProgress?.(index + 1, candidates.length);
    let profile: AssetSemanticProfile | null = null;

    for (const provider of providers) {
      try {
        profile = await provider.profileAsset?.(candidate, context) ?? null;
        if (profile) {
          providersUsed.add(provider.providerName);
          break;
        }
      } catch (error) {
        errors.push(`${provider.providerName}:profile:${candidate.id}: ${String(error)}`);
      }
    }

    profiles.push(profile ?? createFallbackAssetProfile(candidate));
  }

  return {
    profiles,
    providersUsed: Array.from(providersUsed),
    errors,
  };
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

function buildHeuristicRanking(request: AiSegmentRequest, context: AiScoringContext): AiSegmentRanking {
  const textTokens = tokenize(request.text);
  const directionTokens = tokenize(
    [
      context.editGoal,
      context.editStyle,
      context.brollStyle,
      context.captionStyle,
      context.ctaContext,
      context.creativeDirection,
      context.brandNotes,
      request.customInstructions,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const intentTokens = inferIntentTokens(`${request.text} ${directionTokens.join(" ")}`);
  const prefersVideo = shouldPreferVideo(request.text, context);
  const rankedAssets = request.candidates
    .map<AiRankedAsset>((candidate) => {
      const nameTokens = tokenize(candidate.name);
      const descriptorTokens = tokenize(candidate.descriptor ?? "");
      const folderTokens = candidate.folderKeywords ?? [];
      const candidateTokens = new Set([...nameTokens, ...descriptorTokens, ...folderTokens]);
      const overlapScore = scoreTokenOverlap([...textTokens, ...intentTokens, ...directionTokens], candidateTokens);
      const visualBonus = candidate.visualPaths?.length ? 0.08 : 0;
      const mediaTypeBonus =
        prefersVideo && candidate.mediaType === "video"
          ? 0.1
          : !prefersVideo && candidate.mediaType === "image"
            ? 0.035
            : 0;
      const durationBonus = candidate.durationSec && request.endSec
        ? Math.max(0, 0.1 - Math.abs(candidate.durationSec - (request.endSec - request.startSec)) * 0.008)
        : 0;
      const score = clampScore(0.12 + overlapScore + visualBonus + durationBonus + mediaTypeBonus);
      const lowConfidenceReason =
        score < 0.32
          ? "Only weak filename/folder/metadata overlap; review before placing or leave face-time."
          : undefined;

      return {
        candidateId: candidate.id,
        score,
        rationale: score > 0.35
          ? `Heuristic matched transcript intent to filename/folder metadata (${candidate.mediaType}${candidate.durationSec ? `, ${candidate.durationSec.toFixed(1)}s` : ""}).`
          : "Heuristic kept this as a low-confidence coverage option instead of treating it as a strong match.",
        sourceDurationSec: candidate.durationSec,
        visualMatchReason: `Intent tokens: ${intentTokens.slice(0, 5).join(", ") || "general"}; recipe tokens: ${directionTokens.slice(0, 4).join(", ") || "none"}; asset tokens from filename/folder.`,
        lowConfidenceReason,
        matchKind: score < 0.32 ? "fallback" : overlapScore > 0.18 ? "literal" : "style",
        mediaPreference: prefersVideo ? "video" : "either",
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
  const scoresByCandidate = new Map<string, {
    total: number;
    weight: number;
    rationales: string[];
    sourceDurationSec?: number;
    visualMatchReasons: string[];
    lowConfidenceReasons: string[];
    matchKind?: AiRankedAsset["matchKind"];
    mediaPreference?: AiRankedAsset["mediaPreference"];
  }>();

  rankings.forEach((ranking) => {
    const weight = ranking.provider === "heuristic" ? 0.65 : 1;
    ranking.rankedAssets.forEach((asset, rankIndex) => {
      const existing = scoresByCandidate.get(asset.candidateId) ?? {
        total: 0,
        weight: 0,
        rationales: [],
        visualMatchReasons: [],
        lowConfidenceReasons: [],
      };
      const rankBonus = Math.max(0, 0.04 - rankIndex * 0.01);
      existing.total += clampScore(asset.score + rankBonus) * weight;
      existing.weight += weight;
      if (asset.rationale) {
        existing.rationales.push(`${ranking.provider}: ${asset.rationale}`);
      }
      existing.sourceDurationSec = existing.sourceDurationSec ?? asset.sourceDurationSec;
      if (asset.visualMatchReason) existing.visualMatchReasons.push(asset.visualMatchReason);
      if (asset.lowConfidenceReason) existing.lowConfidenceReasons.push(asset.lowConfidenceReason);
      existing.matchKind = existing.matchKind ?? asset.matchKind;
      existing.mediaPreference = existing.mediaPreference ?? asset.mediaPreference;
      scoresByCandidate.set(asset.candidateId, existing);
    });
  });

  const rankedAssets = Array.from(scoresByCandidate.entries())
    .map<AiRankedAsset>(([candidateId, score]) => ({
      candidateId,
      score: clampScore(score.weight > 0 ? score.total / score.weight : 0),
      rationale: score.rationales.slice(0, 2).join(" | ") || "Aggregated by timeline agent reviewers.",
      sourceDurationSec: score.sourceDurationSec,
      visualMatchReason: score.visualMatchReasons.slice(0, 2).join(" | ") || undefined,
      lowConfidenceReason: score.lowConfidenceReasons[0],
      matchKind: score.matchKind,
      mediaPreference: score.mediaPreference,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, request.maxRecommendations ?? 6);

  const topScore = rankedAssets[0]?.score ?? 0;
  const providerNames = rankings.map((ranking) => ranking.provider);
  const modelBackedRankings = rankings.filter((ranking) => ranking.provider !== "heuristic");
  const clipFromModels = modelBackedRankings
    .map((ranking) => ranking.suggestedClipCount)
    .filter((value): value is number => typeof value === "number" && value > 0);
  const suggestedClipCount =
    topScore >= 0.52 && clipFromModels.length > 0
      ? clampClipCount(Math.round(clipFromModels.reduce((sum, value) => sum + value, 0) / clipFromModels.length))
      : estimateClipCount(request);

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
    suggestedClipCount,
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
      modelBackedRankings.length === 0
        ? "No live model reviewer responded; heuristic overlap scoring filled this segment."
        : topScore < 0.55
          ? "Reviewer agreement is below the editorial confidence threshold; placement should be reviewed."
          : undefined,
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

function inferIntentTokens(text: string): string[] {
  const lowered = text.toLowerCase();
  const tokens = new Set<string>();
  if (/\b(money|sales|revenue|profit|income|cash)\b/.test(lowered)) {
    ["money", "payment", "dashboard", "laptop", "business", "client", "finance", "revenue"].forEach((token) => tokens.add(token));
  }
  if (/\b(travel|airport|plane|cafe|hotel|remote|freedom)\b/.test(lowered)) {
    ["travel", "airport", "cafe", "remote", "laptop", "plane", "hotel", "work"].forEach((token) => tokens.add(token));
  }
  if (/\b(client|lead|customer|book|quiz|training|call)\b/.test(lowered)) {
    ["client", "lead", "calendar", "call", "form", "training", "crm", "dashboard"].forEach((token) => tokens.add(token));
  }
  if (/\b(step|system|process|how|explain)\b/.test(lowered)) {
    ["screen", "hands", "checklist", "desk", "diagram", "tool", "workspace"].forEach((token) => tokens.add(token));
  }
  return Array.from(tokens);
}

function shouldPreferVideo(text: string, context: AiScoringContext): boolean {
  const brollStyle = context.brollStyle?.toLowerCase() ?? "";
  const editStyle = context.editStyle?.toLowerCase() ?? "";
  if (brollStyle.includes("minimal")) {
    return false;
  }
  if (brollStyle.includes("stock") || editStyle.includes("fast") || editStyle.includes("high-energy")) {
    return true;
  }
  return /\b(travel|walk|move|scroll|dashboard|payment|call|work|show|demonstrate|transition)\b/i.test(text);
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
  const durationDriven = Math.ceil(duration / 6.85);
  const wordDriven = Math.ceil((request.wordCount ?? 0) / 44);
  const sentenceDriven = Math.min(3, Math.max(1, request.sentenceCount ?? 1));
  const incompleteBoost = !request.sentenceComplete && (request.wordCount ?? 0) > 22 ? 1 : 0;
  return clampClipCount(Math.max(durationDriven, Math.min(wordDriven, durationDriven + 2), sentenceDriven + incompleteBoost));
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
