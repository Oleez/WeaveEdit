import { ScriptSegment } from "../script-parser";
import { MediaLibraryItem, getFileName, normalizePath } from "../media";
import {
  AiAssetCandidate,
  AiRankedAsset,
  AiSegmentRanking,
  AssetSemanticProfile,
  AssetReusePolicy,
  CutBoundaryMode,
  DynamicAssignment,
  DynamicEditorResult,
  DynamicEditorSettings,
  EditorPacingPreset,
  MatchStyle,
  ScriptBeat,
} from "./types";
import { clampScore } from "./provider";

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "because",
  "from",
  "have",
  "into",
  "just",
  "like",
  "more",
  "only",
  "that",
  "then",
  "they",
  "this",
  "very",
  "what",
  "when",
  "with",
  "your",
]);

export const DEFAULT_DYNAMIC_EDITOR_SETTINGS: DynamicEditorSettings = {
  pacingPreset: "documentary",
  cutBoundaryMode: "ai",
  matchStyle: "balanced",
  assetReusePolicy: "allow-small-folder-repeat",
  videoTrimPolicy: "trim-to-beat",
  analysisDepth: "visual-frames",
  candidatePoolSize: 80,
  rerankDepth: 12,
  averageShotLengthSec: 5,
  minClipDurationSec: 1.5,
  maxClipDurationSec: 10,
};

export function createFallbackAssetProfile(candidate: AiAssetCandidate): AssetSemanticProfile {
  const name = candidate.name || getFileName(candidate.path);
  const tokens = tokenize(`${name} ${candidate.descriptor ?? ""}`);
  const moodTags = inferMoodTags(tokens);

  return {
    id: candidate.id,
    path: normalizePath(candidate.path),
    name,
    mediaType: candidate.mediaType,
    candidate,
    caption: candidate.descriptor ?? `Visual asset named ${name}.`,
    tags: tokens.slice(0, 12),
    moodTags,
    entities: tokens.filter((token) => token.length > 3).slice(0, 8),
    shotScale: inferShotScale(tokens),
    motionEnergy: candidate.mediaType === "video" ? "active" : "static",
    useCases: inferUseCases(tokens, candidate.mediaType),
    searchText: `${name} ${candidate.descriptor ?? ""} ${tokens.join(" ")} ${moodTags.join(" ")}`,
    confidence: candidate.visualPaths?.length ? 0.42 : 0.28,
    provider: "heuristic-profile",
  };
}

export function buildDynamicEditorResult(
  segments: ScriptSegment[],
  mediaItems: MediaLibraryItem[],
  profiles: AssetSemanticProfile[],
  settings: DynamicEditorSettings,
): DynamicEditorResult {
  const beats = buildScriptBeats(segments, settings);
  const assignments = assignProfilesToBeats(beats, profiles, settings);
  const rankingsBySegmentId = buildRankingsFromAssignments(segments, mediaItems, assignments, settings);

  return {
    profiles,
    beats,
    assignments,
    rankingsBySegmentId,
    metrics: {
      indexedAssets: mediaItems.length,
      profiledAssets: profiles.length,
      beatCount: beats.length,
      assignedBeats: assignments.filter((assignment) => assignment.profile).length,
      reusedAssignments: assignments.filter((assignment) => assignment.reused).length,
    },
  };
}

export function buildScriptBeats(
  segments: ScriptSegment[],
  settings: DynamicEditorSettings,
): ScriptBeat[] {
  const beats: ScriptBeat[] = [];

  segments.forEach((segment, segmentIndex) => {
    const segmentDuration = resolveSegmentDuration(segment, segments[segmentIndex + 1], settings);
    const chunks = splitSegmentIntoBeatText(segment.text, settings.cutBoundaryMode);
    const weights = chunks.map((chunk) => Math.max(1, tokenize(chunk).length));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    let cursor = segment.startSec;

    chunks.forEach((chunk, beatIndex) => {
      const isLast = beatIndex === chunks.length - 1;
      const duration = isLast
        ? segment.startSec + segmentDuration - cursor
        : (segmentDuration * weights[beatIndex]) / totalWeight;
      const startSec = round(cursor);
      const endSec = round(isLast ? segment.startSec + segmentDuration : cursor + duration);
      const keywords = tokenize(chunk).slice(0, 10);
      const emotionalTone = inferEmotionalTone(chunk);

      beats.push({
        id: `${segment.id}-beat-${beatIndex + 1}`,
        segmentId: segment.id,
        segmentIndex,
        beatIndex,
        startSec,
        endSec,
        text: chunk,
        boundary: resolveBoundaryMode(chunk, settings.cutBoundaryMode),
        emotionalTone,
        keywords,
        pacing: inferPacing(settings.pacingPreset, chunk, emotionalTone),
        matchStyle: settings.matchStyle,
        minDurationSec: settings.minClipDurationSec,
        maxDurationSec: settings.maxClipDurationSec,
      });

      cursor = endSec;
    });
  });

  return beats;
}

export function assignProfilesToBeats(
  beats: ScriptBeat[],
  profiles: AssetSemanticProfile[],
  settings: DynamicEditorSettings,
): DynamicAssignment[] {
  const usageByProfileId = new Map<string, number>();

  return beats.map((beat) => {
    let best: { profile: AssetSemanticProfile; score: number; rationale: string; reused: boolean } | null = null;

    profiles.forEach((profile) => {
      const usedCount = usageByProfileId.get(profile.id) ?? 0;
      const relevance = scoreProfileForBeat(profile, beat, settings.matchStyle);
      const reusePenalty = getReusePenalty(usedCount, settings.assetReusePolicy, profiles.length);
      const durationFit = profile.candidate.durationSec
        ? clampScore(1 - Math.abs(profile.candidate.durationSec - (beat.endSec - beat.startSec)) / 30) * 0.08
        : 0;
      const score = clampScore(relevance + durationFit - reusePenalty);

      if (!best || score > best.score) {
        best = {
          profile,
          score,
          reused: usedCount > 0,
          rationale: buildAssignmentRationale(profile, beat, score, usedCount),
        };
      }
    });

    if (!best) {
      return {
        beat,
        profile: null,
        score: 0,
        rationale: "No media profile was available for this beat.",
        reused: false,
      };
    }

    usageByProfileId.set(best.profile.id, (usageByProfileId.get(best.profile.id) ?? 0) + 1);
    return {
      beat,
      profile: best.profile,
      score: best.score,
      rationale: best.rationale,
      reused: best.reused,
    };
  });
}

function buildRankingsFromAssignments(
  segments: ScriptSegment[],
  mediaItems: MediaLibraryItem[],
  assignments: DynamicAssignment[],
  settings: DynamicEditorSettings,
): Record<string, AiSegmentRanking> {
  const mediaPathSet = new Set(mediaItems.map((item) => normalizePath(item.path)));
  const rankings: Record<string, AiSegmentRanking> = {};

  segments.forEach((segment) => {
    const segmentAssignments = assignments.filter((assignment) => assignment.beat.segmentId === segment.id);
    const rankedAssets = dedupeRankedAssets(
      segmentAssignments
        .filter((assignment) => assignment.profile && mediaPathSet.has(normalizePath(assignment.profile.path)))
        .map<AiRankedAsset>((assignment) => ({
          candidateId: assignment.profile?.id ?? "",
          score: assignment.score,
          rationale: assignment.rationale,
        })),
    );
    const averageScore = rankedAssets.length
      ? rankedAssets.reduce((sum, asset) => sum + asset.score, 0) / rankedAssets.length
      : 0;

    rankings[segment.id] = {
      provider: "dynamic-editor",
      segmentId: segment.id,
      confidence: clampScore(averageScore),
      rationale: "Dynamic editor matched full-library asset profiles to script beats and sentence boundaries.",
      rankedAssets,
      fallbackUsed: rankedAssets.length === 0,
      suggestedDurationSec: resolveSegmentDuration(segment, segments[segments.indexOf(segment) + 1], settings),
      suggestedLayerCount: 1,
      suggestedClipCount: Math.max(1, segmentAssignments.length),
      overlapStyle: "single",
      timingRationale: "Beat-aware placement follows script phrase and sentence boundaries.",
      coverageNotes: segmentAssignments.map((assignment) => assignment.rationale).slice(0, 2).join(" | "),
      reviewerNotes: segmentAssignments.map((assignment) => assignment.rationale),
      beatWindows: segmentAssignments.map((assignment) => ({
        id: assignment.beat.id,
        startSec: assignment.beat.startSec,
        endSec: assignment.beat.endSec,
        text: assignment.beat.text,
        emotionalTone: assignment.beat.emotionalTone,
        pacing: assignment.beat.pacing,
      })),
    };
  });

  return rankings;
}

function dedupeRankedAssets(assets: AiRankedAsset[]): AiRankedAsset[] {
  const byId = new Map<string, AiRankedAsset>();
  assets.forEach((asset) => {
    if (!asset.candidateId) {
      return;
    }
    const existing = byId.get(asset.candidateId);
    if (!existing || asset.score > existing.score) {
      byId.set(asset.candidateId, asset);
    }
  });
  return Array.from(byId.values()).sort((left, right) => right.score - left.score);
}

function resolveSegmentDuration(
  segment: ScriptSegment,
  nextSegment: ScriptSegment | undefined,
  settings: Pick<DynamicEditorSettings, "averageShotLengthSec" | "maxClipDurationSec">,
): number {
  if (segment.endSec && segment.endSec > segment.startSec) {
    return Math.max(0.3, segment.endSec - segment.startSec);
  }
  if (nextSegment && nextSegment.startSec > segment.startSec) {
    return Math.max(0.3, nextSegment.startSec - segment.startSec);
  }
  return Math.max(settings.averageShotLengthSec, Math.min(settings.maxClipDurationSec, segment.wordCount / 2.6));
}

function splitSegmentIntoBeatText(text: string, boundaryMode: CutBoundaryMode): string[] {
  if (boundaryMode === "phrase" || boundaryMode === "ai") {
    const phrases = text
      .split(/(?<=[,;:])\s+|\s+(?=but|and then|then|because|while|when)\s+/i)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (phrases.length > 1) {
      return phrases;
    }
  }

  if (boundaryMode === "sentence" || boundaryMode === "beat" || boundaryMode === "ai") {
    const sentences = text
      .match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g)
      ?.map((part) => part.trim())
      .filter(Boolean);
    if (sentences && sentences.length > 0) {
      return sentences;
    }
  }

  return [text.trim()].filter(Boolean);
}

function scoreProfileForBeat(
  profile: AssetSemanticProfile,
  beat: ScriptBeat,
  matchStyle: MatchStyle,
): number {
  const searchTokens = new Set(tokenize(profile.searchText));
  const keywordMatches = beat.keywords.filter((keyword) => searchTokens.has(keyword)).length;
  const literalScore = Math.min(0.58, keywordMatches / Math.max(4, beat.keywords.length));
  const moodMatches = profile.moodTags.filter((tag) => tag === beat.emotionalTone || beat.text.toLowerCase().includes(tag)).length;
  const emotionalScore = Math.min(0.34, moodMatches * 0.12 + (profile.moodTags.length ? 0.04 : 0));
  const profileConfidence = profile.confidence * 0.18;

  if (matchStyle === "literal") {
    return clampScore(literalScore + profileConfidence);
  }
  if (matchStyle === "emotional" || matchStyle === "metaphorical") {
    return clampScore(emotionalScore + profileConfidence + literalScore * 0.35);
  }

  return clampScore(literalScore + emotionalScore + profileConfidence);
}

function getReusePenalty(usedCount: number, reusePolicy: AssetReusePolicy, profileCount: number): number {
  if (usedCount === 0) {
    return 0;
  }
  if (reusePolicy === "story-continuity") {
    return Math.min(0.16, usedCount * 0.05);
  }
  if (reusePolicy === "allow-small-folder-repeat" && profileCount < 8) {
    return Math.min(0.22, usedCount * 0.08);
  }
  return Math.min(0.55, usedCount * 0.18);
}

function buildAssignmentRationale(
  profile: AssetSemanticProfile,
  beat: ScriptBeat,
  score: number,
  usedCount: number,
): string {
  const reuseNote = usedCount > 0 ? ` Reused ${usedCount + 1}x due to assignment constraints.` : "";
  return `Matched "${profile.name}" to ${beat.emotionalTone} beat "${beat.text.slice(0, 80)}" with ${(score * 100).toFixed(0)}% fit.${reuseNote}`;
}

function resolveBoundaryMode(text: string, configured: CutBoundaryMode): CutBoundaryMode {
  if (configured !== "ai") {
    return configured;
  }
  return /[.!?]["')\]]*$/.test(text.trim()) ? "sentence" : "phrase";
}

function inferPacing(preset: EditorPacingPreset, text: string, tone: string): ScriptBeat["pacing"] {
  if (preset === "social-fast" || tone === "urgent" || /!|\bfast|quick|sudden|now\b/i.test(text)) {
    return "fast";
  }
  if (preset === "cinematic-slow" || tone === "reflective") {
    return "slow";
  }
  return "medium";
}

function inferEmotionalTone(text: string): string {
  const lowered = text.toLowerCase();
  if (/\bscared|terrifying|fear|danger|risk|panic|urgent\b/.test(lowered)) {
    return "urgent";
  }
  if (/\bsad|lost|alone|quiet|remember|memory|regret\b/.test(lowered)) {
    return "reflective";
  }
  if (/\bhappy|win|excited|energy|amazing|love\b/.test(lowered)) {
    return "uplift";
  }
  if (/\bexplain|because|how|step|learn|process\b/.test(lowered)) {
    return "informative";
  }
  return "neutral";
}

function inferMoodTags(tokens: string[]): string[] {
  const tags = new Set<string>();
  tokens.forEach((token) => {
    if (["dark", "night", "shadow", "storm", "alone"].includes(token)) tags.add("reflective");
    if (["fast", "run", "car", "city", "move", "action"].includes(token)) tags.add("urgent");
    if (["sun", "smile", "bright", "win", "happy"].includes(token)) tags.add("uplift");
    if (["screen", "diagram", "desk", "tool", "work"].includes(token)) tags.add("informative");
  });
  return Array.from(tags.length ? tags : new Set(["neutral"]));
}

function inferShotScale(tokens: string[]): AssetSemanticProfile["shotScale"] {
  if (tokens.some((token) => ["wide", "establishing", "landscape"].includes(token))) return "wide";
  if (tokens.some((token) => ["close", "macro", "detail"].includes(token))) return "close";
  if (tokens.some((token) => ["hands", "object", "texture"].includes(token))) return "detail";
  if (tokens.some((token) => ["medium", "person", "people"].includes(token))) return "medium";
  return "unknown";
}

function inferUseCases(tokens: string[], mediaType: MediaLibraryItem["type"]): string[] {
  const useCases = new Set<string>([mediaType === "video" ? "motion b-roll" : "visual insert"]);
  if (tokens.some((token) => ["wide", "place", "location", "city"].includes(token))) useCases.add("establishing context");
  if (tokens.some((token) => ["hands", "tool", "screen", "label"].includes(token))) useCases.add("literal explanation");
  if (tokens.some((token) => ["shadow", "rain", "window", "alone"].includes(token))) useCases.add("emotional metaphor");
  return Array.from(useCases);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
