import { ScriptSegment } from "./script-parser";
import { AiSegmentRanking, EditorPacingPreset, PlacementStrategyMode } from "./ai/types";
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
  frameRate?: number;
  sequenceEndSec?: number;
  rangeStartSec?: number | null;
  rangeEndSec?: number | null;
  targetSecondsPerClip?: number;
  placementStrategyMode?: PlacementStrategyMode;
  variationStrength?: number;
  /** Drives minimum readable clip spacing when AI beat windows are absent. */
  editorPacingPreset?: EditorPacingPreset;
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
  strategy: "ai" | "manual" | "fallback" | "blank" | "generated";
  mediaPath: string | null;
  mediaName: string | null;
  mediaType: MediaLibraryItem["type"] | null;
  text: string;
  keywordScore: number;
  aiConfidence: number;
  aiRationale: string | null;
  aiVisualMatchReason: string | null;
  matchKind: AiSegmentRanking["rankedAssets"][number]["matchKind"] | null;
  mediaPreference: AiSegmentRanking["rankedAssets"][number]["mediaPreference"] | null;
  aiProvider: string | null;
  lowConfidence: boolean;
  fallbackReason: string | null;
  timingSource: "ai" | "segment" | "heuristic";
  timingRationale: string | null;
  overlapStyle: "single" | "parallel" | "staggered";
  editorialRole: "hook" | "explanation" | "proof" | "transition" | "cta" | "general";
  sourceInSec: number | null;
  sourceOutSec: number | null;
  sourceDurationSec: number | null;
  trimApplied: boolean;
  trimNote: string | null;
  generatedAssetId?: string;
  originalMediaPath?: string | null;
  originalMediaName?: string | null;
  originalMediaType?: MediaLibraryItem["type"] | null;
  originalStrategy?: "ai" | "manual" | "fallback" | "blank";
  usingGeneratedAsset?: boolean;
  generatedAssetSource?: string;
  generatedAssetStatus?: "imported" | "reviewed" | "approved" | "rejected";
  generatedAssetRationale?: string;
}

export interface TimelinePlan {
  placements: TimelinePlacement[];
  matchedByAi: number;
  matchedByFallback: number;
  overlapPlacements: number;
  blanks: number;
  coverage: TimelineCoverageSummary;
}

export interface TimelineCoverageSummary {
  coveredSec: number;
  gapSec: number;
  filledGapCount: number;
  discardedSliverCount: number;
  reusedAssetPlacements: number;
  adjustedPlacementCount: number;
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

interface SegmentWindow {
  durationSec: number;
  maxAvailableWindow: number;
  source: "segment" | "sequence" | "heuristic";
}

interface ClipWindow {
  index: number;
  count: number;
  startSec: number;
  durationSec: number;
  text: string;
  role: TimelinePlacement["editorialRole"];
}

interface AssetMatch {
  asset: MediaCandidate;
  index: number;
  confidence: number;
  rationale: string;
  provider: string;
  lowConfidence: boolean;
  fallbackReason: string | null;
  sourceDurationSec?: number;
  visualMatchReason?: string;
  matchKind?: AiSegmentRanking["rankedAssets"][number]["matchKind"];
  mediaPreference?: AiSegmentRanking["rankedAssets"][number]["mediaPreference"];
}

interface SourceTrimDecision {
  sourceInSec: number | null;
  sourceOutSec: number | null;
  sourceDurationSec: number | null;
  trimApplied: boolean;
  trimNote: string | null;
}

export function buildTimelinePlan(
  segments: ScriptSegment[],
  mediaItems: MediaLibraryItem[],
  settings: TimelinePlannerSettings,
): TimelinePlan {
  const placementStrategyMode = settings.placementStrategyMode ?? "ai-dynamic";
  const usesStrictFolderOrder = placementStrategyMode === "folder-order";
  const usesFolderOrderFallback = placementStrategyMode === "hybrid-fallback";
  const assets = mediaItems
    .slice()
    .sort((left, right) =>
      usesStrictFolderOrder || usesFolderOrderFallback
        ? compareMediaOrder(left, right)
        : left.path.localeCompare(right.path),
    )
    .map<MediaCandidate>((mediaItem) => ({
      ...mediaItem,
      tokens: tokenize(`${mediaItem.name} ${mediaItem.path}`),
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
  let reusedAssetPlacements = 0;
  const aiConfidenceThreshold = settings.aiConfidenceThreshold ?? 0.42;
  const allowLowConfidenceFallback = settings.allowLowConfidenceFallback ?? true;
  const maxOverlapLayers = Math.max(1, settings.maxOverlapLayers ?? 2);
  let nextOrderedAssetIndex = 0;

  segments.forEach((segment, index) => {
    const nextSegment = segments[index + 1];
    const segmentWindow = resolveSegmentWindow(segment, nextSegment, settings);

    const aiRanking = settings.aiRankingsBySegmentId?.[segment.id];
    const durationDecision = resolveDuration(segment, segmentWindow, settings, aiRanking);
    const override = settings.manualOverridesBySegmentId?.[segment.id] ?? "auto";
    const overlapStyle: TimelinePlacement["overlapStyle"] = aiRanking?.overlapStyle ?? "single";
    const groupId = `segment-group-${index + 1}`;
    const clipWindows = createClipWindows(segment, durationDecision.durationSec, settings, aiRanking);
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
      let aiVisualMatchReason: string | null = null;
      let matchKind: TimelinePlacement["matchKind"] = null;
      let mediaPreference: TimelinePlacement["mediaPreference"] = null;
      let aiProvider: string | null = null;
      let lowConfidence = false;
      let fallbackReason: string | null = null;
      let selectedIndex: number | null = null;
      let sourceDurationSec: number | undefined;

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
          aiVisualMatchReason = "Manual selection by editor.";
          matchKind = "fallback";
          aiProvider = "manual";
          selectedIndex = overrideIndex;
          matchedByAi += 1;
        }
      }

      const orderedMatch = !mediaPath && usesStrictFolderOrder
        ? findNextOrderedAsset(assets, assetUsageByIndex, pathsUsedInSegment, nextOrderedAssetIndex)
        : null;

      if (orderedMatch) {
        nextOrderedAssetIndex = orderedMatch.nextCursor;
      }

      const aiMatch = !mediaPath && !orderedMatch
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
      const keywordMatch = !mediaPath && !usesFolderOrderFallback
        ? findKeywordMatch(segment.text, assets, assetUsageByIndex, pathsUsedInSegment, index, clipWindow.startSec)
        : null;
      const orderedFallbackMatch = !mediaPath && usesFolderOrderFallback
        ? findNextOrderedAsset(assets, assetUsageByIndex, pathsUsedInSegment, nextOrderedAssetIndex)
        : null;
      if (orderedFallbackMatch) {
        nextOrderedAssetIndex = orderedFallbackMatch.nextCursor;
      }
      const genericFallbackMatch = !mediaPath && !keywordMatch && !orderedFallbackMatch && assets.length > 0 && shouldUseGenericFallback(aiRanking)
        ? findReusableAsset(assets, assetUsageByIndex, pathsUsedInSegment, index, clipWindow.startSec)
        : null;

      if (!mediaPath && orderedMatch) {
        strategy = "manual";
        mediaPath = orderedMatch.asset.path;
        mediaName = orderedMatch.asset.name;
        mediaType = orderedMatch.asset.type;
        aiConfidence = 1;
        aiRationale = "Strict folder-order mode selected this media by download/creation order.";
        aiVisualMatchReason = "Folder-order mode bypasses semantic review.";
        matchKind = "fallback";
        aiProvider = "folder-order";
        selectedIndex = orderedMatch.index;
        matchedByAi += 1;
      } else if (!mediaPath && aiMatch) {
        strategy = aiMatch.lowConfidence ? "fallback" : "ai";
        mediaPath = aiMatch.asset.path;
        mediaName = aiMatch.asset.name;
        mediaType = aiMatch.asset.type;
        aiConfidence = aiMatch.confidence;
        aiRationale = aiMatch.rationale;
        aiVisualMatchReason = aiMatch.visualMatchReason ?? null;
        matchKind = aiMatch.matchKind ?? null;
        mediaPreference = aiMatch.mediaPreference ?? null;
        aiProvider = aiMatch.provider;
        lowConfidence = aiMatch.lowConfidence;
        fallbackReason = aiMatch.fallbackReason;
        sourceDurationSec = aiMatch.sourceDurationSec;
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
        aiVisualMatchReason = "Lexical fallback matched transcript intent against filename/folder tokens.";
        matchKind = "fallback";
        mediaPreference = prefersVideoFallback(segment.text) ? "video" : "either";
        aiProvider = aiRanking?.provider ?? null;
        lowConfidence = true;
        fallbackReason = "Used lexical fallback because AI confidence was below threshold.";
        selectedIndex = keywordMatch.index;
        matchedByFallback += 1;
      } else if (!mediaPath && orderedFallbackMatch) {
        strategy = "fallback";
        mediaPath = orderedFallbackMatch.asset.path;
        mediaName = orderedFallbackMatch.asset.name;
        mediaType = orderedFallbackMatch.asset.type;
        aiConfidence = aiRanking?.confidence ?? 0;
        aiRationale = aiRanking?.rationale ?? "Hybrid mode used folder order because no strong AI match was available.";
        aiVisualMatchReason = "Hybrid fallback used scanned folder order after semantic match was weak.";
        matchKind = "fallback";
        aiProvider = aiRanking?.provider ?? "folder-order";
        lowConfidence = true;
        fallbackReason = "Used old-to-new folder order as the fallback placement strategy.";
        selectedIndex = orderedFallbackMatch.index;
        matchedByFallback += 1;
      } else if (!mediaPath && genericFallbackMatch) {
        strategy = "fallback";
        mediaPath = genericFallbackMatch.asset.path;
        mediaName = genericFallbackMatch.asset.name;
        mediaType = genericFallbackMatch.asset.type;
        aiConfidence = aiRanking?.confidence ?? 0;
        aiRationale = aiRanking?.rationale ?? "No semantic or lexical match was available, so the least-repeated asset was reused to keep the timeline filled.";
        aiVisualMatchReason = "Least-repeated media fallback; review because semantic relevance is not guaranteed.";
        matchKind = "fallback";
        aiProvider = aiRanking?.provider ?? null;
        lowConfidence = true;
        fallbackReason = "Reused least-repeated available media because no stronger semantic match was found; review before executing.";
        selectedIndex = genericFallbackMatch.index;
        matchedByFallback += 1;
      } else if (!mediaPath && settings.blankWhenNoImage) {
        blanks += 1;
      }

      const sourceTrim = selectedIndex !== null && mediaType === "video"
        ? resolveVideoSourceTrim({
            clipWindow,
            settings,
            sourceDurationSec,
            previousUsage: assetUsageByIndex.get(selectedIndex),
          })
        : createDefaultSourceTrim(mediaType, clipWindow.durationSec);

      if (selectedIndex !== null) {
        const previousUsage = assetUsageByIndex.get(selectedIndex);
        if (previousUsage) {
          reusedAssetPlacements += 1;
        }
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
        aiVisualMatchReason,
        matchKind,
        mediaPreference,
        aiProvider,
        lowConfidence,
        fallbackReason,
        timingSource: durationDecision.source,
        timingRationale: durationDecision.rationale,
        overlapStyle,
        editorialRole: clipWindow.role,
        sourceInSec: sourceTrim.sourceInSec,
        sourceOutSec: sourceTrim.sourceOutSec,
        sourceDurationSec: sourceTrim.sourceDurationSec,
        trimApplied: sourceTrim.trimApplied,
        trimNote: sourceTrim.trimNote,
      });

      if (
        mediaPath &&
        aiRanking &&
        !usesStrictFolderOrder &&
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

  const resolved = resolveNoGapCoverage(placements, settings);

  return {
    placements: resolved.placements,
    matchedByAi,
    matchedByFallback,
    overlapPlacements,
    blanks,
    coverage: {
      ...resolved.summary,
      reusedAssetPlacements,
    },
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
      sourceDurationSec: ranked.sourceDurationSec,
      visualMatchReason: ranked.visualMatchReason,
      matchKind: ranked.matchKind,
      mediaPreference: ranked.mediaPreference,
      fallbackReason:
        aiRanking.confidence < confidenceThreshold
          ? ranked.lowConfidenceReason ?? aiRanking.lowConfidenceReason ?? "AI confidence fell below the review threshold."
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
  const textTokens = tokenize(`${text} ${inferFallbackIntentText(text)}`);
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
    if (prefersVideoFallback(text) && asset.type === "video") {
      score += 0.75;
    }

    if (score < 1) {
      return;
    }

    const adjustedScore = score - getReusePenalty(index, assetUsageByIndex, pathsUsedInSegment, segmentIndex, startSec);

    if (!bestMatch || adjustedScore > bestMatch.adjustedScore) {
      bestMatch = { asset, index, score, adjustedScore };
    }
  });

  return bestMatch;
}

function shouldUseGenericFallback(aiRanking: AiSegmentRanking | undefined): boolean {
  if (!aiRanking) {
    return true;
  }

  return aiRanking.confidence >= 0.26;
}

function inferFallbackIntentText(text: string): string {
  const lowered = text.toLowerCase();
  const tokens: string[] = [];
  if (/\b(money|sales|revenue|profit|income|cash)\b/.test(lowered)) tokens.push("payment dashboard laptop business client finance revenue");
  if (/\b(travel|airport|plane|cafe|hotel|remote|freedom)\b/.test(lowered)) tokens.push("travel airport cafe remote laptop plane hotel work");
  if (/\b(client|lead|customer|book|quiz|training|call)\b/.test(lowered)) tokens.push("client lead calendar call form training crm dashboard");
  if (/\b(step|system|process|how|explain)\b/.test(lowered)) tokens.push("screen hands checklist desk diagram tool workspace");
  return tokens.join(" ");
}

function prefersVideoFallback(text: string): boolean {
  return /\b(travel|walk|move|scroll|dashboard|payment|call|work|show|demonstrate|transition)\b/i.test(text);
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

function findNextOrderedAsset(
  assets: MediaCandidate[],
  assetUsageByIndex: Map<number, AssetUsage>,
  pathsUsedInSegment: Set<string>,
  cursor: number,
): { asset: MediaCandidate; index: number; nextCursor: number } | null {
  if (assets.length === 0) {
    return null;
  }

  for (let offset = 0; offset < assets.length; offset += 1) {
    const index = (cursor + offset) % assets.length;
    const asset = assets[index];
    const used = assetUsageByIndex.has(index);
    const usedInSegment = pathsUsedInSegment.has(normalizePath(asset.path));

    if (!used && !usedInSegment) {
      return { asset, index, nextCursor: index + 1 };
    }
  }

  const repeatIndex = cursor % assets.length;
  return {
    asset: assets[repeatIndex],
    index: repeatIndex,
    nextCursor: repeatIndex + 1,
  };
}

function compareMediaOrder(left: MediaLibraryItem, right: MediaLibraryItem): number {
  return (
    (left.sortKey ?? left.createdMs ?? left.modifiedMs ?? left.folderIndex ?? 0) -
      (right.sortKey ?? right.createdMs ?? right.modifiedMs ?? right.folderIndex ?? 0) ||
    (left.folderIndex ?? 0) - (right.folderIndex ?? 0) ||
    left.path.localeCompare(right.path)
  );
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

function resolveSegmentWindow(
  segment: ScriptSegment,
  nextSegment: ScriptSegment | undefined,
  settings: TimelinePlannerSettings,
): SegmentWindow {
  if (segment.endSec && segment.endSec > segment.startSec) {
    return {
      durationSec: segment.endSec - segment.startSec,
      maxAvailableWindow: segment.endSec - segment.startSec,
      source: "segment",
    };
  }

  if (nextSegment && nextSegment.startSec > segment.startSec) {
    return {
      durationSec: nextSegment.startSec - segment.startSec,
      maxAvailableWindow: nextSegment.startSec - segment.startSec,
      source: "segment",
    };
  }

  const explicitEnd = firstFinitePositive(settings.rangeEndSec, settings.sequenceEndSec);
  if (explicitEnd && explicitEnd > segment.startSec) {
    return {
      durationSec: explicitEnd - segment.startSec,
      maxAvailableWindow: explicitEnd - segment.startSec,
      source: "sequence",
    };
  }

  const estimatedDuration = estimateDurationFromText(segment.text);
  return {
    durationSec: estimatedDuration,
    maxAvailableWindow: estimatedDuration,
    source: "heuristic",
  };
}

function resolveDuration(
  segment: ScriptSegment,
  segmentWindow: SegmentWindow,
  settings: TimelinePlannerSettings,
  aiRanking?: AiSegmentRanking,
): DurationDecision {
  const hasAiSuggestion = Boolean(aiRanking?.suggestedDurationSec && aiRanking.suggestedDurationSec > 0);
  const hasTranscriptWindow = segmentWindow.source !== "heuristic";
  const baseDuration = hasTranscriptWindow
    ? segmentWindow.durationSec
    : hasAiSuggestion
      ? aiRanking?.suggestedDurationSec ?? segmentWindow.durationSec
      : deriveSentenceAwareDuration(segment);

  return {
    durationSec: clampCoverageDuration(baseDuration, segmentWindow.maxAvailableWindow, settings, hasTranscriptWindow),
    source: hasTranscriptWindow ? "segment" : hasAiSuggestion ? "ai" : "heuristic",
    rationale: hasTranscriptWindow
      ? `Filled the ${segmentWindow.source === "sequence" ? "sequence/range" : "transcript"} timing window; AI timing is used only as pacing guidance.`
      : hasAiSuggestion
        ? aiRanking?.timingRationale ?? "Timing proposed by AI transcript analysis."
        : "Derived timing from sentence cadence and completion.",
  };
}

function clampCoverageDuration(
  requestedDuration: number,
  maxWindow: number,
  settings: TimelinePlannerSettings,
  fillWindow: boolean,
): number {
  if (fillWindow && Number.isFinite(maxWindow)) {
    return roundDuration(Math.max(0.3, maxWindow));
  }

  const bounded = Math.min(
    Math.max(requestedDuration, settings.minDurationSec),
    settings.maxDurationSec,
  );

  if (!Number.isFinite(maxWindow)) {
    return roundDuration(bounded);
  }

  return roundDuration(Math.max(0.3, Math.min(bounded, maxWindow)));
}

function firstFinitePositive(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return null;
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
  const role = classifyEditorialRole(segment.text, 0);
  const roleHold =
    role === "hook" || role === "cta"
      ? 0.65
      : role === "proof"
        ? 0.35
        : role === "transition"
          ? -0.25
          : 0;
  return cadenceDuration + punctuationBonus + sentenceBonus + roleHold;
}

function createClipWindows(
  segment: ScriptSegment,
  durationSec: number,
  settings: TimelinePlannerSettings,
  aiRanking?: AiSegmentRanking,
): ClipWindow[] {
  const beatWindows = aiRanking?.beatWindows?.filter((beat) => beat.endSec > beat.startSec);
  if (beatWindows?.length) {
    return beatWindows.map((beatWindow, index) => ({
      index,
      count: beatWindows.length,
      startSec: roundDuration(beatWindow.startSec),
      durationSec: roundDuration(beatWindow.endSec - beatWindow.startSec),
      text: beatWindow.text || segment.text,
      role: classifyEditorialRole(beatWindow.text || segment.text, index),
    }));
  }

  const clipCount = resolveClipCount(segment, durationSec, settings, aiRanking);
  if (clipCount <= 1) {
    return [
      {
        index: 0,
        count: 1,
        startSec: segment.startSec,
        durationSec,
        text: segment.text,
        role: classifyEditorialRole(segment.text, 0),
      },
    ];
  }

  const snippets = splitTextForClips(segment.text, clipCount);
  const clipDurations = distributeClipDurations(snippets, durationSec, settings);
  const windows: ClipWindow[] = [];
  let cursor = segment.startSec;

  for (let clipIndex = 0; clipIndex < clipCount; clipIndex += 1) {
    const startSec = cursor;
    const clipDuration = clipIndex === clipCount - 1
      ? Math.max(0.3, segment.startSec + durationSec - cursor)
      : clipDurations[clipIndex] ?? durationSec / clipCount;
    windows.push({
      index: clipIndex,
      count: clipCount,
      startSec: roundDuration(startSec),
      durationSec: roundDuration(clipDuration),
      text: snippets[clipIndex] ?? segment.text,
      role: classifyEditorialRole(snippets[clipIndex] ?? segment.text, clipIndex),
    });
    cursor = roundDuration(cursor + clipDuration);
  }

  return windows;
}

function distributeClipDurations(
  snippets: string[],
  totalDurationSec: number,
  settings: TimelinePlannerSettings,
): number[] {
  const minimum = Math.max(0.3, Math.min(resolveMinReadableClipSec(settings), totalDurationSec / snippets.length));
  const preset = settings.editorPacingPreset ?? "documentary";
  const variation = Math.max(0, Math.min(1, settings.variationStrength ?? 0.25));
  const rawWeights = snippets.map((snippet, index) => {
    const wordCount = snippet.split(/\s+/).filter(Boolean).length;
    const role = classifyEditorialRole(snippet, index);
    const intensity = estimateTextIntensity(snippet);
    const roleWeight =
      role === "hook" || role === "cta"
        ? 1.22
        : role === "proof"
          ? 1.12
          : role === "transition"
            ? 0.82
            : 1;
    const pacingWeight =
      preset === "social-fast"
        ? 0.88
        : preset === "cinematic-slow"
          ? 1.16
          : preset === "tutorial"
            ? 1.08
            : 1;
    const naturalWeight = Math.max(0.72, Math.sqrt(Math.max(1, wordCount)) / 2.4);
    const drift = 1 + variation * Math.sin((index + 1) * 1.618) * 0.22;
    return Math.max(0.35, naturalWeight * roleWeight * pacingWeight * (1 + intensity * 0.12) * drift);
  });
  const totalWeight = rawWeights.reduce((sum, value) => sum + value, 0) || 1;
  const initial = rawWeights.map((weight) => (weight / totalWeight) * totalDurationSec);
  const bounded = initial.map((value) => Math.max(minimum, value));
  const boundedSum = bounded.reduce((sum, value) => sum + value, 0);
  const scaled = boundedSum > totalDurationSec
    ? bounded.map((value) => (value / boundedSum) * totalDurationSec)
    : bounded;
  const scaledSum = scaled.reduce((sum, value) => sum + value, 0);
  if (scaled.length > 0) {
    scaled[scaled.length - 1] += totalDurationSec - scaledSum;
  }
  return scaled.map(roundDuration);
}

function classifyEditorialRole(text: string, index: number): TimelinePlacement["editorialRole"] {
  const lowered = text.toLowerCase();
  if (index === 0 && /(\?|stop|wait|mistake|secret|truth|nobody|why|how|this is)/.test(lowered)) {
    return "hook";
  }
  if (/\b(comment|dm|click|subscribe|follow|book|buy|send|link|cta|call to action)\b/.test(lowered)) {
    return "cta";
  }
  if (/\b(proof|result|case study|because|data|numbers|client|testimonial|evidence)\b/.test(lowered)) {
    return "proof";
  }
  if (/\b(but|however|meanwhile|then|next|now|so)\b/.test(lowered) && text.split(/\s+/).length < 16) {
    return "transition";
  }
  if (/\b(how|why|step|process|explain|learn|because)\b/.test(lowered)) {
    return "explanation";
  }
  return "general";
}

function estimateTextIntensity(text: string): number {
  const urgentWords = (text.match(/\b(now|never|mistake|risk|secret|truth|win|lose|money|urgent|fast|stop)\b/gi) ?? []).length;
  const punctuation = (text.match(/[!?]/g) ?? []).length;
  return Math.min(1, urgentWords * 0.18 + punctuation * 0.14);
}

function createDefaultSourceTrim(
  mediaType: MediaLibraryItem["type"] | null,
  placementDurationSec: number,
): SourceTrimDecision {
  if (mediaType === "image") {
    return {
      sourceInSec: null,
      sourceOutSec: null,
      sourceDurationSec: null,
      trimApplied: false,
      trimNote: "Image duration varies with transcript role and pacing so stills feel less static.",
    };
  }

  if (mediaType === "video") {
    return {
      sourceInSec: 0,
      sourceOutSec: roundDuration(placementDurationSec),
      sourceDurationSec: null,
      trimApplied: true,
      trimNote: "Using opening section because source duration is unknown.",
    };
  }

  return {
    sourceInSec: null,
    sourceOutSec: null,
    sourceDurationSec: null,
    trimApplied: false,
    trimNote: null,
  };
}

function resolveVideoSourceTrim({
  clipWindow,
  previousUsage,
  settings,
  sourceDurationSec,
}: {
  clipWindow: ClipWindow;
  settings: TimelinePlannerSettings;
  sourceDurationSec?: number;
  previousUsage?: AssetUsage;
}): SourceTrimDecision {
  const placementDurationSec = Math.max(0.3, clipWindow.durationSec);
  if (!sourceDurationSec || !Number.isFinite(sourceDurationSec) || sourceDurationSec <= placementDurationSec + 0.25) {
    return {
      sourceInSec: 0,
      sourceOutSec: roundDuration(placementDurationSec),
      sourceDurationSec: sourceDurationSec ?? null,
      trimApplied: true,
      trimNote: "Using opening section because source duration is unknown or too short for alternate trimming.",
    };
  }

  const safeTailSec = Math.min(1.2, Math.max(0.25, sourceDurationSec * 0.08));
  const latestStartSec = Math.max(0, sourceDurationSec - placementDurationSec - safeTailSec);
  const variation = Math.max(0, Math.min(1, settings.variationStrength ?? 0.25));
  const roleAnchor =
    clipWindow.role === "hook"
      ? 0.08
      : clipWindow.role === "cta"
        ? 0.68
        : clipWindow.role === "proof"
          ? 0.48
          : clipWindow.role === "transition"
            ? 0.36
            : 0.52;
  const pacingShift =
    settings.editorPacingPreset === "social-fast"
      ? -0.08
      : settings.editorPacingPreset === "cinematic-slow"
        ? 0.1
        : 0;
  const reuseShift = previousUsage ? 0.23 + Math.min(0.21, previousUsage.count * 0.07) : 0;
  const drift = Math.sin((clipWindow.index + 1) * 2.414 + placementDurationSec) * 0.12 * variation;
  const anchor = wrap01(roleAnchor + pacingShift + reuseShift + drift);
  const sourceInSec = roundDuration(Math.max(0, Math.min(latestStartSec, latestStartSec * anchor)));
  const sourceOutSec = roundDuration(Math.min(sourceDurationSec - 0.05, sourceInSec + placementDurationSec));
  const note = previousUsage
    ? "Using alternate range to reduce repeated footage."
    : clipWindow.role === "hook"
      ? "Trimmed to match short hook segment."
      : sourceInSec > sourceDurationSec * 0.25
        ? "Using middle section for variation."
        : "Using early section with enough tail safety.";

  return {
    sourceInSec,
    sourceOutSec,
    sourceDurationSec: roundDuration(sourceDurationSec),
    trimApplied: true,
    trimNote: note,
  };
}

function wrap01(value: number): number {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

function resolveClipCount(
  segment: ScriptSegment,
  durationSec: number,
  settings: TimelinePlannerSettings,
  aiRanking?: AiSegmentRanking,
): number {
  const minReadableClipSec = resolveMinReadableClipSec(settings);
  const maxByReadableLength = Math.max(1, Math.floor(durationSec / minReadableClipSec));
  const targetSecondsPerClip = resolveTargetSecondsPerClip(settings);
  const preset = settings.editorPacingPreset ?? "documentary";
  const isFast = preset === "social-fast";
  const wordDivisor = isFast ? 26 : 46;
  const wordDensityClipEstimate = Math.ceil((segment.wordCount || 0) / wordDivisor);
  const sentenceCeiling = Math.min(segment.sentenceCount || 1, isFast ? 8 : 3);
  const durationBased = Math.ceil(durationSec / targetSecondsPerClip);
  const deterministicCount = Math.max(
    durationBased,
    Math.min(wordDensityClipEstimate, maxByReadableLength),
    Math.min(sentenceCeiling, maxByReadableLength),
  );

  const aiClipCount = aiRanking?.suggestedClipCount;
  const threshold = settings.aiConfidenceThreshold ?? 0.42;
  if (aiClipCount && aiClipCount > 0 && (aiRanking?.confidence ?? 0) >= threshold) {
    const roundedAi = Math.round(aiClipCount);
    const blended = Math.max(durationBased, Math.min(maxByReadableLength, roundedAi));
    return clampClipCount(blended, maxByReadableLength);
  }

  return clampClipCount(deterministicCount, maxByReadableLength);
}

function resolveTargetSecondsPerClip(settings: TimelinePlannerSettings): number {
  const configured = settings.targetSecondsPerClip ?? settings.maxDurationSec;
  if (!Number.isFinite(configured)) {
    return 6;
  }

  return Math.max(resolveMinReadableClipSec(settings), Math.min(12, configured));
}

function resolveMinReadableClipSec(settings: TimelinePlannerSettings): number {
  const preset = settings.editorPacingPreset ?? "documentary";
  const configured = settings.minDurationSec;
  const baseMin = Math.max(1.35, Math.min(5, configured * 1.05));
  if (preset === "social-fast") {
    return Math.max(1.08, Math.min(3.2, configured));
  }
  if (preset === "cinematic-slow") {
    return Math.max(2.15, Math.min(6, baseMin));
  }
  return Math.max(1.5, Math.min(4.8, baseMin));
}

function clampClipCount(value: number, maxByReadableLength = 64): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.min(Math.max(1, maxByReadableLength), Math.round(value)));
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

export function resolveTimelineCoverage(
  placements: TimelinePlacement[],
  settings: Pick<
    TimelinePlannerSettings,
    | "frameRate"
    | "minDurationSec"
    | "maxDurationSec"
    | "rangeStartSec"
    | "rangeEndSec"
    | "targetSecondsPerClip"
    | "variationStrength"
    | "editorPacingPreset"
  >,
): { placements: TimelinePlacement[]; summary: Omit<TimelineCoverageSummary, "reusedAssetPlacements"> } {
  const frameRate = Math.max(1, settings.frameRate ?? 30);
  const minReadableClipSec = resolveMinReadableClipSec({
    minDurationSec: settings.minDurationSec,
    maxDurationSec: settings.maxDurationSec,
    blankWhenNoImage: true,
    variationStrength: settings.variationStrength,
    editorPacingPreset: settings.editorPacingPreset,
  });
  const primaryPlacements = placements
    .filter((placement) => placement.trackOffset === 0)
    .sort((left, right) => left.startSec - right.startSec || left.id.localeCompare(right.id));
  const overlayPlacements = placements.filter((placement) => placement.trackOffset !== 0);

  if (primaryPlacements.length === 0) {
    return {
      placements: quantizePlacements(placements, frameRate),
      summary: {
        coveredSec: 0,
        gapSec: 0,
        filledGapCount: 0,
        discardedSliverCount: 0,
        adjustedPlacementCount: 0,
      },
    };
  }

  const targetStartSec = quantizeToFrame(
    typeof settings.rangeStartSec === "number" && Number.isFinite(settings.rangeStartSec)
      ? settings.rangeStartSec
      : primaryPlacements[0].startSec,
    frameRate,
  );
  const targetEndSec = quantizeToFrame(
    typeof settings.rangeEndSec === "number" && Number.isFinite(settings.rangeEndSec) && settings.rangeEndSec > targetStartSec
      ? settings.rangeEndSec
      : primaryPlacements[primaryPlacements.length - 1].endSec,
    frameRate,
  );
  const targetSpanSec = Math.max(0, targetEndSec - targetStartSec);
  const maxReadablePlacements = Math.max(1, Math.floor(targetSpanSec / minReadableClipSec));
  const discardIds = new Set<string>();
  let discardedSliverCount = 0;

  primaryPlacements
    .map((placement) => ({
      id: placement.id,
      durationSec: Math.max(0, placement.endSec - placement.startSec),
    }))
    .sort((left, right) => left.durationSec - right.durationSec)
    .forEach((entry) => {
      const remaining = primaryPlacements.length - discardIds.size;
      if (remaining <= maxReadablePlacements && entry.durationSec >= minReadableClipSec) {
        return;
      }

      if (remaining > 1 && (entry.durationSec < minReadableClipSec || remaining > maxReadablePlacements)) {
        discardIds.add(entry.id);
        discardedSliverCount += 1;
      }
    });

  const keptPrimary = primaryPlacements.filter((placement) => !discardIds.has(placement.id));
  const resolvedPrimary: TimelinePlacement[] = [];
  let cursor = targetStartSec;
  let filledGapCount = 0;
  let adjustedPlacementCount = 0;

  keptPrimary.forEach((placement, index) => {
    const isLast = index === keptPrimary.length - 1;
    const originalStart = quantizeToFrame(Math.max(targetStartSec, placement.startSec), frameRate);
    const startSec = originalStart > cursor + 1 / frameRate ? cursor : Math.max(cursor, originalStart);
    const desiredEnd = isLast ? targetEndSec : Math.max(placement.endSec, startSec + 1 / frameRate);
    const endSec = quantizeToFrame(Math.min(targetEndSec, Math.max(startSec + 1 / frameRate, desiredEnd)), frameRate);

    if (Math.abs(placement.startSec - startSec) > 1 / frameRate || Math.abs(placement.endSec - endSec) > 1 / frameRate) {
      adjustedPlacementCount += 1;
    }

    if (originalStart > cursor + 1 / frameRate) {
      filledGapCount += 1;
    }

    const durationSec = roundDuration(Math.max(1 / frameRate, endSec - startSec));
    resolvedPrimary.push({
      ...placement,
      startSec,
      endSec,
      durationSec,
      sourceOutSec: alignSourceOutToDuration(placement, durationSec),
      fallbackReason:
        placement.fallbackReason ??
        (adjustedPlacementCount > 0 ? "Adjusted by no-gap resolver to keep transcript coverage continuous." : null),
    });
    cursor = endSec;
  });

  const resolvedOverlays = overlayPlacements
    .filter((placement) => !discardIds.has(placement.id))
    .map((placement) => quantizePlacement(placement, frameRate));
  const resolvedPlacements = [...resolvedPrimary, ...resolvedOverlays]
    .sort((left, right) => left.startSec - right.startSec || left.trackOffset - right.trackOffset || left.id.localeCompare(right.id));

  return {
    placements: resolvedPlacements,
    summary: {
      coveredSec: roundDuration(targetSpanSec),
      gapSec: 0,
      filledGapCount,
      discardedSliverCount,
      adjustedPlacementCount,
    },
  };
}

function resolveNoGapCoverage(
  placements: TimelinePlacement[],
  settings: TimelinePlannerSettings,
): { placements: TimelinePlacement[]; summary: Omit<TimelineCoverageSummary, "reusedAssetPlacements"> } {
  return resolveTimelineCoverage(placements, settings);
}

function quantizePlacements(placements: TimelinePlacement[], frameRate: number): TimelinePlacement[] {
  return placements.map((placement) => quantizePlacement(placement, frameRate));
}

function quantizePlacement(placement: TimelinePlacement, frameRate: number): TimelinePlacement {
  const startSec = quantizeToFrame(placement.startSec, frameRate);
  const endSec = quantizeToFrame(Math.max(startSec + 1 / frameRate, placement.endSec), frameRate);
  const durationSec = roundDuration(endSec - startSec);
  return {
    ...placement,
    startSec,
    endSec,
    durationSec,
    sourceOutSec: alignSourceOutToDuration(placement, durationSec),
  };
}

function alignSourceOutToDuration(placement: TimelinePlacement, durationSec: number): number | null {
  if (placement.mediaType !== "video" || placement.sourceInSec === null) {
    return placement.sourceOutSec;
  }

  const desiredOut = roundDuration(placement.sourceInSec + durationSec);
  if (placement.sourceDurationSec && Number.isFinite(placement.sourceDurationSec)) {
    return roundDuration(Math.min(Math.max(placement.sourceInSec, placement.sourceDurationSec - 0.05), desiredOut));
  }

  return desiredOut;
}

function quantizeToFrame(seconds: number, frameRate: number): number {
  return Math.round(seconds * frameRate) / frameRate;
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
    aiVisualMatchReason: null,
    matchKind: null,
    mediaPreference: null,
    aiProvider: null,
    lowConfidence: false,
    fallbackReason: null,
    timingSource: input.durationDecision.source,
    timingRationale: input.durationDecision.rationale,
    overlapStyle: input.overlapStyle,
    editorialRole: input.clipWindow.role,
    sourceInSec: null,
    sourceOutSec: null,
    sourceDurationSec: null,
    trimApplied: false,
    trimNote: null,
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
    aiVisualMatchReason: input.match.rationale,
    matchKind: "style",
    mediaPreference: input.match.asset.type,
    aiProvider: input.provider,
    lowConfidence: input.lowConfidence,
    fallbackReason: input.fallbackReason,
    timingSource: input.timingSource,
    timingRationale: input.timingRationale,
    overlapStyle: input.overlapStyle,
    editorialRole: input.clipWindow.role,
    sourceInSec: input.match.asset.type === "video" ? 0 : null,
    sourceOutSec: input.match.asset.type === "video" ? roundDuration(overlapDuration) : null,
    sourceDurationSec: null,
    trimApplied: input.match.asset.type === "video",
    trimNote:
      input.match.asset.type === "video"
        ? `Overlay video trims source from 0s to ${roundDuration(overlapDuration).toFixed(2)}s in the current host workflow.`
        : input.match.asset.type === "image"
          ? "Overlay still duration follows the active overlap style."
          : null,
  };
}
