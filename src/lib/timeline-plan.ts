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

interface AssetUsage {
  count: number;
  lastSegmentIndex: number;
  lastEndSec: number;
}

interface DurationDecision {
  durationSec: number;
  source: TimelinePlacement["timingSource"];
  rationale: string;
}

interface ClipWindow {
  index: number;
  count: number;
  startSec: number;
  durationSec: number;
  text: string;
}

interface AssetMatch {
  asset: MediaCandidate;
  index: number;
  confidence: number;
  rationale: string;
  provider: string;
  lowConfidence: boolean;
  fallbackReason: string | null;
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

  const assetUsageByIndex = new Map<number, AssetUsage>();
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
    const overlapStyle: TimelinePlacement["overlapStyle"] = aiRanking?.overlapStyle ?? "single";
    const groupId = `segment-group-${index + 1}`;
    const clipWindows = createClipWindows(segment, durationDecision.durationSec, aiRanking);
    const pathsUsedInSegment = new Set<string>();

    if (override === "blank") {
      clipWindows.forEach((clipWindow) => {
        blanks += 1;
        placements.push(createBlankPlacement({
          id: buildPlacementId(index, clipWindow),
          groupId,
          segment,
          clipWindow,
          durationDecision,
          overlapStyle,
          rationale: "Manually overridden to blank.",
        }));
      });
      return;
    }

    clipWindows.forEach((clipWindow) => {
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
      let selectedIndex: number | null = null;

      if (override !== "auto" && override) {
        const overrideIndex = assetIndexByPath.get(normalizePath(override));
        if (overrideIndex !== undefined) {
          const overrideAsset = assets[overrideIndex];
          strategy = "manual";
          mediaPath = overrideAsset.path;
          mediaName = overrideAsset.name;
          mediaType = overrideAsset.type;
          aiConfidence = 1;
          aiRationale = "Manually overridden in review.";
          aiProvider = "manual";
          selectedIndex = overrideIndex;
          matchedByAi += 1;
        }
      }

      const aiMatch = !mediaPath
        ? findAiMatch(
            aiRanking,
            assets,
            assetIndexByPath,
            assetUsageByIndex,
            pathsUsedInSegment,
            aiConfidenceThreshold,
            override,
            allowLowConfidenceFallback,
            index,
            clipWindow.startSec,
          )
        : null;
      const keywordMatch = !mediaPath
        ? findKeywordMatch(segment.text, assets, assetUsageByIndex, pathsUsedInSegment, index, clipWindow.startSec)
        : null;
      const genericFallbackMatch = !mediaPath && !keywordMatch && assets.length > 0
        ? findReusableAsset(assets, assetUsageByIndex, pathsUsedInSegment, index, clipWindow.startSec)
        : null;

      if (!mediaPath && aiMatch) {
        strategy = aiMatch.lowConfidence ? "fallback" : "ai";
        mediaPath = aiMatch.asset.path;
        mediaName = aiMatch.asset.name;
        mediaType = aiMatch.asset.type;
        aiConfidence = aiMatch.confidence;
        aiRationale = aiMatch.rationale;
        aiProvider = aiMatch.provider;
        lowConfidence = aiMatch.lowConfidence;
        fallbackReason = aiMatch.fallbackReason;
        selectedIndex = aiMatch.index;
        if (aiMatch.lowConfidence) {
          matchedByFallback += 1;
        } else {
          matchedByAi += 1;
        }
      } else if (!mediaPath && keywordMatch) {
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
        selectedIndex = keywordMatch.index;
        matchedByFallback += 1;
      } else if (!mediaPath && genericFallbackMatch) {
        strategy = "fallback";
        mediaPath = genericFallbackMatch.asset.path;
        mediaName = genericFallbackMatch.asset.name;
        mediaType = genericFallbackMatch.asset.type;
        aiConfidence = aiRanking?.confidence ?? 0;
        aiRationale = aiRanking?.rationale ?? "No semantic or lexical match was available, so the least-repeated asset was reused to keep the timeline filled.";
        aiProvider = aiRanking?.provider ?? null;
        lowConfidence = true;
        fallbackReason = "Reused available media to avoid leaving this script span blank.";
        selectedIndex = genericFallbackMatch.index;
        matchedByFallback += 1;
      } else if (!mediaPath && settings.blankWhenNoImage) {
        blanks += 1;
      }

      if (selectedIndex !== null) {
        recordAssetUsage(assetUsageByIndex, selectedIndex, index, clipWindow.startSec + clipWindow.durationSec);
        pathsUsedInSegment.add(normalizePath(assets[selectedIndex].path));
      }

      placements.push({
        id: buildPlacementId(index, clipWindow),
        groupId,
        segmentId: segment.id,
        layerIndex: 0,
        trackOffset: 0,
        startSec: roundDuration(clipWindow.startSec),
        endSec: roundDuration(clipWindow.startSec + clipWindow.durationSec),
        durationSec: roundDuration(clipWindow.durationSec),
        strategy,
        mediaPath,
        mediaName,
        mediaType,
        text: clipWindow.text,
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
          assetUsageByIndex,
          pathsUsedInSegment,
          mediaPath,
          index,
          clipWindow.startSec,
        );

        if (secondaryMatch) {
          recordAssetUsage(assetUsageByIndex, secondaryMatch.index, index, clipWindow.startSec + clipWindow.durationSec);
          pathsUsedInSegment.add(normalizePath(secondaryMatch.asset.path));
          const overlapPlacement = createOverlapPlacement({
            placementId: `${index + 1}-${clipWindow.index + 1}-overlay-1`,
            groupId,
            segment,
            clipWindow,
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
  assetUsageByIndex: Map<number, AssetUsage>,
  pathsUsedInSegment: Set<string>,
  confidenceThreshold: number,
  override: string | "blank" | "auto",
  allowLowConfidenceFallback: boolean,
  segmentIndex: number,
  startSec: number,
): AssetMatch | null {
  if (!aiRanking || override === "blank") {
    return null;
  }

  if (aiRanking.confidence < confidenceThreshold && !allowLowConfidenceFallback) {
    return null;
  }

  let bestMatch: AssetMatch | null = null;
  let bestAdjustedScore = Number.NEGATIVE_INFINITY;

  for (const ranked of aiRanking.rankedAssets) {
    const index = assetIndexByPath.get(normalizePath(ranked.candidateId));
    if (index === undefined) {
      continue;
    }

    const asset = assets[index];
    const adjustedScore = (ranked.score || aiRanking.confidence) - getReusePenalty(
      index,
      assetUsageByIndex,
      pathsUsedInSegment,
      segmentIndex,
      startSec,
    );

    if (adjustedScore <= bestAdjustedScore) {
      continue;
    }

    bestAdjustedScore = adjustedScore;
    bestMatch = {
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

  return bestMatch;
}

function findKeywordMatch(
  text: string,
  assets: MediaCandidate[],
  assetUsageByIndex: Map<number, AssetUsage>,
  pathsUsedInSegment: Set<string>,
  segmentIndex: number,
  startSec: number,
): { asset: MediaCandidate; index: number; score: number } | null {
  const textTokens = tokenize(text);
  let bestMatch: { asset: MediaCandidate; index: number; score: number; adjustedScore: number } | null = null;

  if (textTokens.size === 0) {
    return null;
  }

  assets.forEach((asset, index) => {
    let score = 0;
    textTokens.forEach((token) => {
      if (asset.tokens.has(token)) {
        score += 1;
      }
    });

    if (score === 0) {
      return;
    }

    const adjustedScore = score - getReusePenalty(index, assetUsageByIndex, pathsUsedInSegment, segmentIndex, startSec);

    if (!bestMatch || adjustedScore > bestMatch.adjustedScore) {
      bestMatch = { asset, index, score, adjustedScore };
    }
  });

  return bestMatch;
}

function findReusableAsset(
  assets: MediaCandidate[],
  assetUsageByIndex: Map<number, AssetUsage>,
  pathsUsedInSegment: Set<string>,
  segmentIndex: number,
  startSec: number,
): { asset: MediaCandidate; index: number } | null {
  let bestMatch: { asset: MediaCandidate; index: number; adjustedScore: number } | null = null;

  assets.forEach((asset, index) => {
    const adjustedScore = -getReusePenalty(index, assetUsageByIndex, pathsUsedInSegment, segmentIndex, startSec);
    if (!bestMatch || adjustedScore > bestMatch.adjustedScore) {
      bestMatch = { asset, index, adjustedScore };
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

function buildPlacementId(segmentIndex: number, clipWindow: ClipWindow): string {
  return clipWindow.count === 1
    ? `placement-${segmentIndex + 1}`
    : `placement-${segmentIndex + 1}-${clipWindow.index + 1}`;
}

function deriveSentenceAwareDuration(segment: ScriptSegment): number {
  const cadenceDuration = Math.max(1.25, segment.wordCount / 2.8);
  const punctuationBonus = segment.sentenceComplete ? 0.75 : 0;
  const sentenceBonus = Math.min(1.25, Math.max(0, segment.sentenceCount - 1) * 0.35);
  return cadenceDuration + punctuationBonus + sentenceBonus;
}

function createClipWindows(
  segment: ScriptSegment,
  durationSec: number,
  aiRanking?: AiSegmentRanking,
): ClipWindow[] {
  const clipCount = resolveClipCount(segment, durationSec, aiRanking);
  if (clipCount <= 1) {
    return [
      {
        index: 0,
        count: 1,
        startSec: segment.startSec,
        durationSec,
        text: segment.text,
      },
    ];
  }

  const snippets = splitTextForClips(segment.text, clipCount);
  const baseDuration = durationSec / clipCount;
  const windows: ClipWindow[] = [];

  for (let clipIndex = 0; clipIndex < clipCount; clipIndex += 1) {
    const startSec = segment.startSec + baseDuration * clipIndex;
    const endSec = clipIndex === clipCount - 1 ? segment.startSec + durationSec : startSec + baseDuration;
    windows.push({
      index: clipIndex,
      count: clipCount,
      startSec: roundDuration(startSec),
      durationSec: roundDuration(endSec - startSec),
      text: snippets[clipIndex] ?? segment.text,
    });
  }

  return windows;
}

function resolveClipCount(
  segment: ScriptSegment,
  durationSec: number,
  aiRanking?: AiSegmentRanking,
): number {
  const aiClipCount = aiRanking?.suggestedClipCount;
  if (aiClipCount && aiClipCount > 0) {
    return clampClipCount(Math.round(aiClipCount));
  }

  const durationDrivenCount = Math.ceil(durationSec / 5.5);
  const wordDrivenCount = Math.ceil((segment.wordCount || 0) / 18);
  const sentenceDrivenCount = Math.max(1, segment.sentenceCount || 1);
  const incompleteBoost = !segment.sentenceComplete && (segment.wordCount || 0) > 16 ? 1 : 0;

  return clampClipCount(Math.max(durationDrivenCount, wordDrivenCount, sentenceDrivenCount + incompleteBoost));
}

function clampClipCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.min(4, value));
}

function splitTextForClips(text: string, clipCount: number): string[] {
  const sentenceParts = text
    .match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g)
    ?.map((part) => part.trim())
    .filter(Boolean);

  if (sentenceParts && sentenceParts.length >= clipCount) {
    return distributeParts(sentenceParts, clipCount);
  }

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return Array.from({ length: clipCount }, () => text);
  }

  const wordsPerClip = Math.ceil(words.length / clipCount);
  return Array.from({ length: clipCount }, (_, index) =>
    words.slice(index * wordsPerClip, (index + 1) * wordsPerClip).join(" ") || text,
  );
}

function distributeParts(parts: string[], bucketCount: number): string[] {
  const buckets = Array.from({ length: bucketCount }, () => "");
  parts.forEach((part, index) => {
    const bucketIndex = Math.min(bucketCount - 1, Math.floor((index * bucketCount) / parts.length));
    buckets[bucketIndex] = `${buckets[bucketIndex]} ${part}`.trim();
  });
  return buckets.map((bucket) => bucket || (parts[0] ?? ""));
}

function getReusePenalty(
  index: number,
  assetUsageByIndex: Map<number, AssetUsage>,
  pathsUsedInSegment: Set<string>,
  segmentIndex: number,
  startSec: number,
): number {
  const usage = assetUsageByIndex.get(index);
  if (!usage) {
    return 0;
  }

  const sameSegmentPenalty = pathsUsedInSegment.size > 0 ? 0.18 : 0;
  const repeatPenalty = Math.min(0.45, usage.count * 0.12);
  const adjacentPenalty = usage.lastSegmentIndex >= segmentIndex - 1 ? 0.14 : 0;
  const temporalPenalty = Math.abs(startSec - usage.lastEndSec) < 1 ? 0.08 : 0;

  return repeatPenalty + sameSegmentPenalty + adjacentPenalty + temporalPenalty;
}

function recordAssetUsage(
  assetUsageByIndex: Map<number, AssetUsage>,
  index: number,
  segmentIndex: number,
  endSec: number,
) {
  const existing = assetUsageByIndex.get(index);
  assetUsageByIndex.set(index, {
    count: (existing?.count ?? 0) + 1,
    lastSegmentIndex: segmentIndex,
    lastEndSec: endSec,
  });
}

function findSecondaryAiMatch(
  aiRanking: AiSegmentRanking,
  assets: MediaCandidate[],
  assetIndexByPath: Map<string, number>,
  assetUsageByIndex: Map<number, AssetUsage>,
  pathsUsedInSegment: Set<string>,
  excludedPath: string,
  segmentIndex: number,
  startSec: number,
): { asset: MediaCandidate; index: number; confidence: number; rationale: string } | null {
  let bestMatch: { asset: MediaCandidate; index: number; confidence: number; rationale: string; adjustedScore: number } | null = null;

  for (const ranked of aiRanking.rankedAssets.slice(1)) {
    const index = assetIndexByPath.get(normalizePath(ranked.candidateId));
    if (index === undefined) {
      continue;
    }

    const asset = assets[index];
    if (normalizePath(asset.path) === normalizePath(excludedPath)) {
      continue;
    }

    if ((ranked.score ?? 0) < 0.28) {
      continue;
    }

    const adjustedScore = ranked.score - getReusePenalty(index, assetUsageByIndex, pathsUsedInSegment, segmentIndex, startSec);
    if (bestMatch && adjustedScore <= bestMatch.adjustedScore) {
      continue;
    }

    bestMatch = {
      asset,
      index,
      confidence: ranked.score,
      rationale: ranked.rationale,
      adjustedScore,
    };
  }

  return bestMatch;
}

function createBlankPlacement(input: {
  id: string;
  groupId: string;
  segment: ScriptSegment;
  clipWindow: ClipWindow;
  durationDecision: DurationDecision;
  overlapStyle: TimelinePlacement["overlapStyle"];
  rationale: string;
}): TimelinePlacement {
  return {
    id: input.id,
    groupId: input.groupId,
    segmentId: input.segment.id,
    layerIndex: 0,
    trackOffset: 0,
    startSec: roundDuration(input.clipWindow.startSec),
    endSec: roundDuration(input.clipWindow.startSec + input.clipWindow.durationSec),
    durationSec: roundDuration(input.clipWindow.durationSec),
    strategy: "blank",
    mediaPath: null,
    mediaName: null,
    mediaType: null,
    text: input.clipWindow.text,
    keywordScore: 0,
    aiConfidence: 0,
    aiRationale: input.rationale,
    aiProvider: null,
    lowConfidence: false,
    fallbackReason: null,
    timingSource: input.durationDecision.source,
    timingRationale: input.durationDecision.rationale,
    overlapStyle: input.overlapStyle,
  };
}

function createOverlapPlacement(input: {
  placementId: string;
  groupId: string;
  segment: ScriptSegment;
  clipWindow: ClipWindow;
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
      ? input.clipWindow.startSec + Math.min(input.clipWindow.durationSec * 0.18, Math.max(0.2, input.clipWindow.durationSec - 0.6))
      : input.clipWindow.startSec;
  const overlapDuration =
    input.overlapStyle === "staggered" ? Math.max(0.6, input.clipWindow.durationSec * 0.72) : input.clipWindow.durationSec;

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
    text: input.clipWindow.text,
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

