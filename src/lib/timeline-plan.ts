import { ScriptSegment } from "./script-parser";

export interface TimelinePlannerSettings {
  minDurationSec: number;
  maxDurationSec: number;
  blankWhenNoImage: boolean;
}

export interface TimelinePlacement {
  id: string;
  segmentId: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  strategy: "keyword" | "sequential" | "blank";
  imagePath: string | null;
  imageName: string | null;
  text: string;
  keywordScore: number;
}

export interface TimelinePlan {
  placements: TimelinePlacement[];
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

interface ImageCandidate {
  path: string;
  name: string;
  tokens: Set<string>;
}

export function buildTimelinePlan(
  segments: ScriptSegment[],
  imagePaths: string[],
  settings: TimelinePlannerSettings,
): TimelinePlan {
  const images = imagePaths
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .map<ImageCandidate>((imagePath) => ({
      path: imagePath,
      name: getFileName(imagePath),
      tokens: tokenize(getFileName(imagePath)),
    }));

  const usedImageIndexes = new Set<number>();
  const placements: TimelinePlacement[] = [];
  let sequentialCursor = 0;
  let matchedByKeyword = 0;
  let matchedSequentially = 0;
  let blanks = 0;

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
    const keywordMatch = findKeywordMatch(segment.text, images, usedImageIndexes);

    let strategy: TimelinePlacement["strategy"] = "blank";
    let imagePath: string | null = null;
    let imageName: string | null = null;
    let keywordScore = 0;

    if (keywordMatch) {
      usedImageIndexes.add(keywordMatch.index);
      sequentialCursor = Math.max(sequentialCursor, keywordMatch.index + 1);
      strategy = "keyword";
      imagePath = keywordMatch.image.path;
      imageName = keywordMatch.image.name;
      keywordScore = keywordMatch.score;
      matchedByKeyword += 1;
    } else {
      sequentialCursor = advanceToUnusedIndex(sequentialCursor, images.length, usedImageIndexes);

      if (sequentialCursor < images.length) {
        usedImageIndexes.add(sequentialCursor);
        strategy = "sequential";
        imagePath = images[sequentialCursor].path;
        imageName = images[sequentialCursor].name;
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
      imagePath,
      imageName,
      text: segment.text,
      keywordScore,
    });
  });

  return {
    placements,
    matchedByKeyword,
    matchedSequentially,
    blanks,
  };
}

function findKeywordMatch(
  text: string,
  images: ImageCandidate[],
  usedImageIndexes: Set<number>,
): { image: ImageCandidate; index: number; score: number } | null {
  const textTokens = tokenize(text);
  let bestMatch: { image: ImageCandidate; index: number; score: number } | null = null;

  if (textTokens.size === 0) {
    return null;
  }

  images.forEach((image, index) => {
    if (usedImageIndexes.has(index)) {
      return;
    }

    let score = 0;
    textTokens.forEach((token) => {
      if (image.tokens.has(token)) {
        score += 1;
      }
    });

    if (score === 0) {
      return;
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { image, index, score };
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

function getFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? filePath;
}
