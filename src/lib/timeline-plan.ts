import { ScriptSegment } from "./script-parser";
import { AiSegmentRanking } from "./ai/types";
import { MediaLibraryItem, normalizePath } from "./media";

export interface TimelinePlannerSettings {
  minDurationSec: number;
  maxDurationSec: number;
  blankWhenNoImage: boolean;
  aiRankingsBySegmentId?: Record<string, AiSegmentRanking>;
  manualOverridesBySegmentId?: Record<string, string | "blank" | "auto">;
  aiConfidenceThreshold?: number;
  allowLowConfidenceFallback?: boolean;
  maxOverlapLayers?: number;
}

export interface TimelinePlacement {
  id: string;
  groupId: string;
  segmentId: string;
  layerIndex: number;
  trackOffset: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  strategy: "ai" | "manual" | "fallback" | "blank";
  mediaPath: string | null;
  mediaName: string | null;
  mediaType: MediaLibraryItem["type"] | null;
  text: string;
  keywordScore: number;
  aiConfidence: number;
  aiRationale: string | null;
  aiProvider: string | null;
  lowConfidence: boolean;
  fallbackReason: string | null;
  timingSource: "ai" | "segment" | "heuristic";
  timingRationale: string | null;
  overlapStyle: "single" | "parallel" | "staggered";
}

export interface TimelinePlan {
  placements: TimelinePlacement[];
  matchedByAi: number;
  matchedByFallback: number;
  overlapPlacements: number;
  blanks: number;
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "along",
  "also",
  "because",
  "being",
  "between",
  "could",
  "every",
  "from",
  "have",
  "into",
  "just",
  "like",
  "more",
  "only",
  "other",
  "over",
  "some",
  "than",
  "that",
  "them",
  "then",
  "they",
  "this",
  "very",
  "what",
  "when",
  "with",
  "your",
]);

interface MediaCandidate extends MediaLibraryItem {
  tokens: Set<string>;
}

export function buildTimelinePlan(
  segments: ScriptSegment[],
  mediaItems: MediaLibraryItem[],
  settings: TimelinePlannerSettings,
): TimelinePlan {
  const assets = mediaItems
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path))
    .map<MediaCandidate>((mediaItem) => ({
      ...mediaItem,
      tokens: tokenize(mediaItem.name),
    }));

  const usedAssetIndexes = new Set<number>();
  const assetIndexByPath = new Map<string, number>();
  assets.forEach((asset, index) => {
    assetIndexByPath.set(normalizePath(asset.path), index);
  });
  const placements: TimelinePlacement[] = [];
  let matchedByAi = 0;
  let matchedByFallback = 0;
  let overlapPlacements = 0;
  let blanks = 0;
  const aiConfidenceThreshold = settings.aiConfidenceThreshold ?? 0.42;
  const allowLowConfidenceFallback = settings.allowLowConfidenceFallback ?? true;
  const maxOverlapLayers = Math.max(1, settings.maxOverlapLayers ?? 2);

  segments.forEach((segment, index) => {
    const nextSegment = segments[index + 1];
    const rawWindow =
      segment.endSec && segment.endSec > segment.startSec
        ? segment.endSec - segment.startSec
        : nextSegment && nextSegment.startSec > segment.startSec
          ? nextSegment.startSec - segment.startSec
          : estimateDurationFromText(segment.text);

    const maxAvailableWindow =
      nextSegment && nextSegment.startSec > segment.startSec
        ? nextSegment.startSec - segment.startSec
        : Number.POSITIVE_INFINITY;

    const aiRanking = settings.aiRankingsBySegmentId?.[segment.id];
    const durationDecision = resolveDuration(segment, rawWindow, maxAvailableWindow, settings, aiRanking);
    const override = settings.manualOverridesBySegmentId?.[segment.id] ?? "auto";
    const aiMatch = findAiMatch(
      aiRanking,
      assets,
      assetIndexByPath,
      usedAssetIndexes,
      aiConfidenceThreshold,
      override,
      allowLowConfidenceFallback,
    );
    const keywordMatch = findKeywordMatch(segment.text, assets, usedAssetIndexes);

    let strategy: TimelinePlacement["strategy"] = "blank";
    let mediaPath: string | null = null;
    let mediaName: string | null = null;
    let mediaType: MediaLibraryItem["type"] | null = null;
    let keywordScore = 0;
    let aiConfidence = 0;
    let aiRationale: string | null = null;
    let aiProvider: string | null = null;
    let lowConfidence = false;
    let fallbackReason: string | null = null;
    const overlapStyle: TimelinePlacement["overlapStyle"] = aiRanking?.overlapStyle ?? "single";
    const groupId = `segment-group-${index + 1}`;

    if (override === "blank") {
      blanks += 1;
      placements.push({
        id: `placement-${index + 1}`,
        groupId,
        segmentId: segment.id,
        layerIndex: 0,
        trackOffset: 0,
        startSec: segment.startSec,
        endSec: segment.startSec + durationDecision.durationSec,
        durationSec: durationDecision.durationSec,
        strategy,
        mediaPath,
        mediaName,
        mediaType,
        text: segment.text,
        keywordScore,
        aiConfidence,
        aiRationale: "Manually overridden to blank.",
        aiProvider,
        lowConfidence,
        fallbackReason,
        timingSource: durationDecision.source,
        timingRationale: durationDecision.rationale,
        overlapStyle,
      });
      return;
    }

    if (override !== "auto" && override) {
      const overrideIndex = assetIndexByPath.get(normalizePath(override));
      if (overrideIndex !== undefined && !usedAssetIndexes.has(overrideIndex)) {
        usedAssetIndexes.add(overrideIndex);
        strategy = "manual";
        mediaPath = assets[overrideIndex].path;
        mediaName = assets[overrideIndex].name;
        mediaType = assets[overrideIndex].type;
        aiConfidence = 1;
        aiRationale = "Manually overridden in review.";
        aiProvider = "manual";
        matchedByAi += 1;
      }
    }

    if (!mediaPath && aiMatch) {
      usedAssetIndexes.add(aiMatch.index);
      strategy = aiMatch.lowConfidence ? "fallback" : "ai";
      mediaPath = aiMatch.asset.path;
      mediaName = aiMatch.asset.name;
      mediaType = aiMatch.asset.type;
      aiConfidence = aiMatch.confidence;
      aiRationale = aiMatch.rationale;
      aiProvider = aiMatch.provider;
      lowConfidence = aiMatch.lowConfidence;
      fallbackReason = aiMatch.fallbackReason;
      if (aiMatch.lowConfidence) {
        matchedByFallback += 1;
      } else {
        matchedByAi += 1;
      }
    } else if (!mediaPath && keywordMatch) {
      usedAssetIndexes.add(keywordMatch.index);
      strategy = "fallback";
      mediaPath = keywordMatch.asset.path;
      mediaName = keywordMatch.asset.name;
      mediaType = keywordMatch.asset.type;
      keywordScore = keywordMatch.score;
      aiConfidence = aiRanking?.confidence ?? 0;
      aiRationale = aiRanking?.rationale ?? "No high-confidence semantic match was available, so a lexical hint was used.";
      aiProvider = aiRanking?.provider ?? null;
      lowConfidence = true;
      fallbackReason = "Used lexical fallback because AI confidence was below threshold.";
      matchedByFallback += 1;
    } else if (!mediaPath && settings.blankWhenNoImage) {
      blanks += 1;
    }

    placements.push({
      id: `placement-${index + 1}`,
      groupId,
      segmentId: segment.id,
      layerIndex: 0,
      trackOffset: 0,
      startSec: segment.startSec,
      endSec: segment.startSec + durationDecision.durationSec,
      durationSec: durationDecision.durationSec,
      strategy,
      mediaPath,
      mediaName,
      mediaType,
      text: segment.text,
      keywordScore,
      aiConfidence,
      aiRationale,
      aiProvider,
      lowConfidence,
      fallbackReason,
      timingSource: durationDecision.source,
      timingRationale: durationDecision.rationale,
      overlapStyle,
    });

    if (
      mediaPath &&
      aiRanking &&
      maxOverlapLayers > 1 &&
      aiRanking.suggestedLayerCount &&
      aiRanking.suggestedLayerCount > 1
    ) {
      const secondaryMatch = findSecondaryAiMatch(
        aiRanking,
        assets,
        assetIndexByPath,
        usedAssetIndexes,
        mediaPath,
      );

      if (secondaryMatch) {
        usedAssetIndexes.add(secondaryMatch.index);
        const overlapPlacement = createOverlapPlacement({
          placementId: `${index + 1}-overlay-1`,
          groupId,
          segment,
          durationSec: durationDecision.durationSec,
          overlapStyle,
          baseConfidence: aiConfidence,
          baseRationale: aiRationale,
          provider: aiProvider,
          lowConfidence,
          fallbackReason,
          timingSource: durationDecision.source,
          timingRationale: durationDecision.rationale,
          match: secondaryMatch,
        });
        placements.push(overlapPlacement);
        overlapPlacements += 1;
      }
    }
  });

  return {
    placements,
    matchedByAi,
    matchedByFallback,
    overlapPlacements,
    blanks,
  };
}

function findAiMatch(
  aiRanking: AiSegmentRanking | undefined,
  assets: MediaCandidate[],
  assetIndexByPath: Map<string, number>,
  usedAssetIndexes: Set<number>,
  confidenceThreshold: number,
  override: string | "blank" | "auto",
  allowLowConfidenceFallback: boolean,
): {
  asset: MediaCandidate;
  index: number;
  confidence: number;
  rationale: string;
  provider: string;
  lowConfidence: boolean;
  fallbackReason: string | null;
} | null {
  if (!aiRanking || override === "blank") {
    return null;
  }

  if (aiRanking.confidence < confidenceThreshold && !allowLowConfidenceFallback) {
    return null;
  }

  for (const ranked of aiRanking.rankedAssets) {
    const index = assetIndexByPath.get(normalizePath(ranked.candidateId));
    if (index === undefined || usedAssetIndexes.has(index)) {
      continue;
    }

    const asset = assets[index];
    return {
      asset,
      index,
      confidence: ranked.score || aiRanking.confidence,
      rationale: ranked.rationale || aiRanking.rationale,
      provider: aiRanking.provider,
      lowConfidence: aiRanking.confidence < confidenceThreshold,
      fallbackReason:
        aiRanking.confidence < confidenceThreshold
          ? aiRanking.lowConfidenceReason ?? "AI confidence fell below the review threshold."
          : null,
    };
  }

  return null;
}

function findKeywordMatch(
  text: string,
  assets: MediaCandidate[],
  usedAssetIndexes: Set<number>,
): { asset: MediaCandidate; index: number; score: number } | null {
  const textTokens = tokenize(text);
  let bestMatch: { asset: MediaCandidate; index: number; score: number } | null = null;

  if (textTokens.size === 0) {
    return null;
  }

  assets.forEach((asset, index) => {
    if (usedAssetIndexes.has(index)) {
      return;
    }

    let score = 0;
    textTokens.forEach((token) => {
      if (asset.tokens.has(token)) {
        score += 1;
      }
    });

    if (score === 0) {
      return;
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { asset, index, score };
    }
  });

  return bestMatch;
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, "")
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
  );
}

function estimateDurationFromText(text: string): number {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.min(8, wordCount / 2.2));
}

function resolveDuration(
  segment: ScriptSegment,
  rawWindow: number,
  maxWindow: number,
  settings: TimelinePlannerSettings,
  aiRanking?: AiSegmentRanking,
): {
  durationSec: number;
  source: TimelinePlacement["timingSource"];
  rationale: string;
} {
  const hasAiSuggestion = Boolean(aiRanking?.suggestedDurationSec && aiRanking.suggestedDurationSec > 0);
  const baseDuration = hasAiSuggestion
    ? aiRanking?.suggestedDurationSec ?? rawWindow
    : segment.endSec && segment.endSec > segment.startSec
      ? rawWindow
      : deriveSentenceAwareDuration(segment);

  return {
    durationSec: clampDuration(baseDuration, maxWindow, settings),
    source: hasAiSuggestion ? "ai" : segment.endSec ? "segment" : "heuristic",
    rationale: hasAiSuggestion
      ? aiRanking?.timingRationale ?? "Timing proposed by AI transcript analysis."
      : segment.endSec
        ? "Used transcript timing from the segment window."
        : "Derived timing from sentence cadence and completion.",
  };
}

function clampDuration(
  requestedDuration: number,
  maxWindow: number,
  settings: TimelinePlannerSettings,
): number {
  const bounded = Math.min(
    Math.max(requestedDuration, settings.minDurationSec),
    settings.maxDurationSec,
  );

  if (!Number.isFinite(maxWindow)) {
    return roundDuration(bounded);
  }

  return roundDuration(Math.max(0.3, Math.min(bounded, maxWindow)));
}

function roundDuration(value: number): number {
  return Math.round(value * 100) / 100;
}

function deriveSentenceAwareDuration(segment: ScriptSegment): number {
  const cadenceDuration = Math.max(1.25, segment.wordCount / 2.8);
  const punctuationBonus = segment.sentenceComplete ? 0.75 : 0;
  const sentenceBonus = Math.min(1.25, Math.max(0, segment.sentenceCount - 1) * 0.35);
  return cadenceDuration + punctuationBonus + sentenceBonus;
}

function findSecondaryAiMatch(
  aiRanking: AiSegmentRanking,
  assets: MediaCandidate[],
  assetIndexByPath: Map<string, number>,
  usedAssetIndexes: Set<number>,
  excludedPath: string,
): { asset: MediaCandidate; index: number; confidence: number; rationale: string } | null {
  for (const ranked of aiRanking.rankedAssets.slice(1)) {
    const index = assetIndexByPath.get(normalizePath(ranked.candidateId));
    if (index === undefined || usedAssetIndexes.has(index)) {
      continue;
    }

    const asset = assets[index];
    if (normalizePath(asset.path) === normalizePath(excludedPath)) {
      continue;
    }

    if ((ranked.score ?? 0) < 0.28) {
      continue;
    }

    return {
      asset,
      index,
      confidence: ranked.score,
      rationale: ranked.rationale,
    };
  }

  return null;
}

function createOverlapPlacement(input: {
  placementId: string;
  groupId: string;
  segment: ScriptSegment;
  durationSec: number;
  overlapStyle: TimelinePlacement["overlapStyle"];
  baseConfidence: number;
  baseRationale: string | null;
  provider: string | null;
  lowConfidence: boolean;
  fallbackReason: string | null;
  timingSource: TimelinePlacement["timingSource"];
  timingRationale: string | null;
  match: { asset: MediaCandidate; index: number; confidence: number; rationale: string };
}): TimelinePlacement {
  const overlapStart =
    input.overlapStyle === "staggered"
      ? input.segment.startSec + Math.min(input.durationSec * 0.18, Math.max(0.2, input.durationSec - 0.6))
      : input.segment.startSec;
  const overlapDuration =
    input.overlapStyle === "staggered" ? Math.max(0.6, input.durationSec * 0.72) : input.durationSec;

  return {
    id: `placement-${input.placementId}`,
    groupId: input.groupId,
    segmentId: input.segment.id,
    layerIndex: 1,
    trackOffset: 1,
    startSec: roundDuration(overlapStart),
    endSec: roundDuration(overlapStart + overlapDuration),
    durationSec: roundDuration(overlapDuration),
    strategy: input.lowConfidence ? "fallback" : "ai",
    mediaPath: input.match.asset.path,
    mediaName: input.match.asset.name,
    mediaType: input.match.asset.type,
    text: input.segment.text,
    keywordScore: 0,
    aiConfidence: input.match.confidence,
    aiRationale: input.match.rationale || input.baseRationale,
    aiProvider: input.provider,
    lowConfidence: input.lowConfidence,
    fallbackReason: input.fallbackReason,
    timingSource: input.timingSource,
    timingRationale: input.timingRationale,
    overlapStyle: input.overlapStyle,
  };
}

