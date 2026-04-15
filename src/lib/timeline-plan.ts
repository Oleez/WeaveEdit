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
}

export interface TimelinePlacement {
  id: string;
  segmentId: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  strategy: "ai" | "keyword" | "sequential" | "blank";
  mediaPath: string | null;
  mediaName: string | null;
  mediaType: MediaLibraryItem["type"] | null;
  text: string;
  keywordScore: number;
  aiConfidence: number;
  aiRationale: string | null;
  aiProvider: string | null;
}

export interface TimelinePlan {
  placements: TimelinePlacement[];
  matchedByAi: number;
  matchedByKeyword: number;
  matchedSequentially: number;
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
  let sequentialCursor = 0;
  let matchedByKeyword = 0;
  let matchedSequentially = 0;
  let blanks = 0;
  const aiConfidenceThreshold = settings.aiConfidenceThreshold ?? 0.42;

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

    const durationSec = clampDuration(rawWindow, maxAvailableWindow, settings);
    const override = settings.manualOverridesBySegmentId?.[segment.id] ?? "auto";
    const aiRanking = settings.aiRankingsBySegmentId?.[segment.id];
    const aiMatch = findAiMatch(
      aiRanking,
      assets,
      assetIndexByPath,
      usedAssetIndexes,
      aiConfidenceThreshold,
      override,
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

    if (override === "blank") {
      blanks += 1;
      placements.push({
        id: `placement-${index + 1}`,
        segmentId: segment.id,
        startSec: segment.startSec,
        endSec: segment.startSec + durationSec,
        durationSec,
        strategy,
        mediaPath,
        mediaName,
        mediaType,
        text: segment.text,
        keywordScore,
        aiConfidence,
        aiRationale: "Manually overridden to blank.",
        aiProvider,
      });
      return;
    }

    if (override !== "auto" && override) {
      const overrideIndex = assetIndexByPath.get(normalizePath(override));
      if (overrideIndex !== undefined && !usedAssetIndexes.has(overrideIndex)) {
        usedAssetIndexes.add(overrideIndex);
        sequentialCursor = Math.max(sequentialCursor, overrideIndex + 1);
        strategy = "ai";
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
      sequentialCursor = Math.max(sequentialCursor, aiMatch.index + 1);
      strategy = "ai";
      mediaPath = aiMatch.asset.path;
      mediaName = aiMatch.asset.name;
      mediaType = aiMatch.asset.type;
      aiConfidence = aiMatch.confidence;
      aiRationale = aiMatch.rationale;
      aiProvider = aiMatch.provider;
      matchedByAi += 1;
    } else if (!mediaPath && keywordMatch) {
      usedAssetIndexes.add(keywordMatch.index);
      sequentialCursor = Math.max(sequentialCursor, keywordMatch.index + 1);
      strategy = "keyword";
      mediaPath = keywordMatch.asset.path;
      mediaName = keywordMatch.asset.name;
      mediaType = keywordMatch.asset.type;
      keywordScore = keywordMatch.score;
      matchedByKeyword += 1;
    } else if (!mediaPath) {
      sequentialCursor = advanceToUnusedIndex(sequentialCursor, assets.length, usedAssetIndexes);

      if (sequentialCursor < assets.length) {
        usedAssetIndexes.add(sequentialCursor);
        strategy = "sequential";
        mediaPath = assets[sequentialCursor].path;
        mediaName = assets[sequentialCursor].name;
        mediaType = assets[sequentialCursor].type;
        matchedSequentially += 1;
        sequentialCursor += 1;
      } else if (settings.blankWhenNoImage) {
        blanks += 1;
      }
    }

    placements.push({
      id: `placement-${index + 1}`,
      segmentId: segment.id,
      startSec: segment.startSec,
      endSec: segment.startSec + durationSec,
      durationSec,
      strategy,
      mediaPath,
      mediaName,
      mediaType,
      text: segment.text,
      keywordScore,
      aiConfidence,
      aiRationale,
      aiProvider,
    });
  });

  return {
    placements,
    matchedByAi,
    matchedByKeyword,
    matchedSequentially,
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
): { asset: MediaCandidate; index: number; confidence: number; rationale: string; provider: string } | null {
  if (!aiRanking || override === "blank") {
    return null;
  }

  if (aiRanking.confidence < confidenceThreshold) {
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

function advanceToUnusedIndex(
  startIndex: number,
  total: number,
  usedIndexes: Set<number>,
): number {
  let cursor = startIndex;

  while (cursor < total && usedIndexes.has(cursor)) {
    cursor += 1;
  }

  return cursor;
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

