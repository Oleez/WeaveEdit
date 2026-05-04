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
  variationStrength: 0.38,
  minClipDurationSec: 1.5,
  maxClipDurationSec: 10,
  editGoal: "Views / Retention",
  editStyle: "Premium Business",
  brollStyle: "Mixed",
  captionStyle: "Clean Bold",
  ctaContext: "",
  creativeDirection: "",
  brandNotes: "",
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
      roleTags: inferRoleTags(tokens),
      visualStyle: inferVisualStyle(tokens, candidate.mediaType),
      searchText: `${name} ${candidate.folderKeywords?.join(" ") ?? ""} ${candidate.descriptor ?? ""} ${tokens.join(" ")} ${moodTags.join(" ")}`,
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
  const heuristicShare =
    profiles.length === 0 ? 1 : profiles.filter((p) => p.provider === "heuristic-profile").length / profiles.length;
  const pipelineFallbackReason =
    settings.analysisDepth === "fast"
      ? "Fast analysis skipped vision profiling; placement uses metadata-aware profiles before beat assignment."
      : heuristicShare >= 0.72
        ? "Most assets resolved to metadata-only profiles; visual frames or full AI review improves semantic confidence."
        : undefined;
  const rankingsBySegmentId = buildRankingsFromAssignments(
    segments,
    mediaItems,
    assignments,
    settings,
    pipelineFallbackReason,
  );

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

function pacingReadableFloor(preset: EditorPacingPreset): number {
  switch (preset) {
    case "social-fast":
      return 1.15;
    case "cinematic-slow":
      return 2.65;
    case "tutorial":
      return 1.75;
    default:
      return 1.55;
  }
}

function beatWordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function mergeChunksToBeatBudget(chunks: string[], maxBeats: number): string[] {
  let cur = [...chunks];
  while (cur.length > maxBeats) {
    let bestIdx = 0;
    let bestScore = Infinity;
    for (let i = 0; i < cur.length - 1; i++) {
      const score = beatWordCount(cur[i]) + beatWordCount(cur[i + 1]);
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const mergedText = `${cur[bestIdx]} ${cur[bestIdx + 1]}`.replace(/\s+/g, " ").trim();
    cur = [...cur.slice(0, bestIdx), mergedText, ...cur.slice(bestIdx + 2)];
  }
  return cur;
}

function hashBeatSeed(segmentId: string, segmentIndex: number, startSec: number): number {
  let h = 2166136261 >>> 0;
  const str = `${segmentId}|${segmentIndex}|${startSec.toFixed(3)}`;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeBeatDurationSum(raw: number[], total: number, minD: number, maxD: number): number[] {
  const n = raw.length;
  if (n === 0) {
    return [];
  }

  const minSum = minD * n;
  if (total <= 0.35) {
    const each = total / n;
    return Array.from({ length: n }, (_, index) =>
      round(index === n - 1 ? Math.max(0.35, total - each * (n - 1)) : Math.max(0.35, each)),
    );
  }

  if (total + 1e-4 < minSum) {
    const each = total / n;
    return Array.from({ length: n }, () => round(Math.max(0.35, each)));
  }

  const d = raw.map((value) => round(Math.max(minD, Math.min(maxD, value))));
  let diff = round(total - d.reduce((sum, value) => sum + value, 0));

  for (let iter = 0; iter < 56 && Math.abs(diff) > 0.02; iter++) {
    const flex = d
      .map((value, index) => ({ index, up: maxD - value, down: value - minD }))
      .filter((entry) => entry.up > 0.02 || entry.down > 0.02);
    if (flex.length === 0) {
      break;
    }
    const step = diff / flex.length;
    for (const entry of flex) {
      const next = round(Math.max(minD, Math.min(maxD, d[entry.index] + step)));
      diff -= next - d[entry.index];
      d[entry.index] = next;
    }
  }

  if (Math.abs(diff) > 0.02 && n > 0) {
    const last = n - 1;
    d[last] = round(Math.max(minD, Math.min(maxD, d[last] + diff)));
    diff = round(total - d.reduce((sum, value) => sum + value, 0));
  }

  if (Math.abs(diff) > 0.05 && n > 0) {
    d[n - 1] = round(Math.max(minD, d[n - 1] + diff));
  }

  return d;
}

function boundedRandomBeatDurations(
  base: number[],
  total: number,
  strength: number,
  minD: number,
  maxD: number,
  seed: number,
): number[] {
  const n = base.length;
  if (n === 0) {
    return [];
  }

  const rng = mulberry32(seed ^ 0x9e3779b9);
  const clampStrength = Math.max(0, Math.min(1, strength));

  if (n === 1 || clampStrength <= 0.001) {
    return normalizeBeatDurationSum(base, total, minD, maxD);
  }

  let perturbed = base.map((value) => value * (1 + clampStrength * (2 * rng() - 1) * 0.34));
  const sum = perturbed.reduce((accumulator, value) => accumulator + value, 0);
  perturbed = perturbed.map((value) => (value / sum) * total);
  return normalizeBeatDurationSum(perturbed, total, minD, maxD);
}

export function buildScriptBeats(
  segments: ScriptSegment[],
  settings: DynamicEditorSettings,
): ScriptBeat[] {
  const beats: ScriptBeat[] = [];

  segments.forEach((segment, segmentIndex) => {
    const segmentDuration = resolveSegmentDuration(segment, segments[segmentIndex + 1], settings);
    let chunks = splitSegmentIntoBeatText(segment.text, settings.cutBoundaryMode);
    if (chunks.length === 0) {
      chunks = [segment.text.trim()].filter(Boolean);
    }

    const presetFloor = pacingReadableFloor(settings.pacingPreset);
    const readableFloor = Math.max(settings.minClipDurationSec, presetFloor);
    const idealSpan = Math.max(readableFloor, settings.averageShotLengthSec * 0.72);
    const maxBeatsByDuration = Math.max(1, Math.floor(segmentDuration / readableFloor));
    const targetBeatBudget = Math.max(1, Math.min(maxBeatsByDuration, Math.ceil(segmentDuration / idealSpan)));

    if (chunks.length > targetBeatBudget) {
      chunks = mergeChunksToBeatBudget(chunks, targetBeatBudget);
    }

    const weights = chunks.map((chunk) => resolveBeatWeight(chunk, settings.pacingPreset));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    const baseDurations = weights.map((weight) => (segmentDuration * weight) / totalWeight);
    const beatMin = readableFloor;
    const beatMax = settings.maxClipDurationSec;
    const seed = hashBeatSeed(segment.id, segmentIndex, segment.startSec);
    const durations = boundedRandomBeatDurations(
      baseDurations,
      segmentDuration,
      settings.variationStrength,
      beatMin,
      beatMax,
      seed,
    );

    let cursor = segment.startSec;

    chunks.forEach((chunk, beatIndex) => {
      const isLast = beatIndex === chunks.length - 1;
      const startSec = round(cursor);
      const endSec = isLast ? round(segment.startSec + segmentDuration) : round(cursor + (durations[beatIndex] ?? 0));
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
        visualIntent: inferVisualIntent(chunk, settings),
        editorialRole: inferEditorialRole(chunk, segmentIndex, beatIndex),
        visualMode: inferVisualMode(chunk, settings),
        preferVideo: inferPreferVideo(chunk, settings),
        keywords,
        pacing: inferPacing(settings.pacingPreset, chunk, emotionalTone),
        matchStyle: settings.matchStyle,
        minDurationSec: beatMin,
        maxDurationSec: beatMax,
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
      const relevance = scoreProfileForBeat(profile, beat, settings);
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
  pipelineFallbackReason?: string | null,
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
          sourceDurationSec: assignment.profile?.candidate.durationSec,
          visualMatchReason: assignment.profile
            ? `${assignment.beat.visualIntent}; ${assignment.profile.caption}`
            : undefined,
          lowConfidenceReason:
            assignment.score < 0.42
              ? `Weak semantic overlap for ${assignment.beat.editorialRole} beat; consider face-time or manual review.`
              : undefined,
          matchKind:
            assignment.profile?.visualStyle === "literal" || assignment.profile?.visualStyle === "metaphorical"
              ? assignment.profile.visualStyle
              : assignment.profile?.visualStyle === "background" || assignment.profile?.visualStyle === "overlay"
                ? "style"
                : assignment.score < 0.42
                  ? "fallback"
                  : "literal",
          mediaPreference: assignment.beat.preferVideo ? "video" : "either",
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
      timingRationale:
        "Beat windows follow merged phrase/sentence chunks with bounded random duration inside each transcript span.",
      coverageNotes: segmentAssignments.map((assignment) => assignment.rationale).slice(0, 2).join(" | "),
      reviewerNotes: segmentAssignments.map((assignment) => assignment.rationale),
      lowConfidenceReason:
        rankedAssets.length === 0
          ? "No library media matched scored beats for this segment."
          : pipelineFallbackReason ?? undefined,
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
    const phrases = splitPhrasesWithoutLookbehind(text);
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

function splitPhrasesWithoutLookbehind(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  const words = text.split(/\s+/).filter(Boolean);

  words.forEach((word, index) => {
    const normalized = word.toLowerCase().replace(/[^a-z]/g, "");
    const startsNewPhrase =
      index > 0 && ["but", "because", "while", "when", "then"].includes(normalized);

    if (startsNewPhrase && current.trim()) {
      parts.push(current.trim());
      current = word;
      return;
    }

    current = `${current} ${word}`.trim();

    if (/[,;:]$/.test(word)) {
      parts.push(current.trim());
      current = "";
    }
  });

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts.filter(Boolean);
}

function resolveBeatWeight(text: string, pacingPreset: EditorPacingPreset): number {
  const tokens = tokenize(text);
  const wordWeight = Math.max(1, tokens.length);
  const punctuationWeight = /[.!?]["')\]]*$/.test(text.trim()) ? 1.2 : /[,;:]$/.test(text.trim()) ? 0.8 : 1;
  const pacingWeight =
    pacingPreset === "social-fast"
      ? 0.82
      : pacingPreset === "cinematic-slow"
        ? 1.28
        : pacingPreset === "tutorial"
          ? 1.1
          : 1;
  const emotionalWeight = inferEmotionalTone(text) === "reflective" ? 1.18 : inferEmotionalTone(text) === "urgent" ? 0.88 : 1;

  return Math.max(0.75, wordWeight * punctuationWeight * pacingWeight * emotionalWeight);
}

function scoreProfileForBeat(
  profile: AssetSemanticProfile,
  beat: ScriptBeat,
  settings: DynamicEditorSettings,
): number {
  const matchStyle = settings.matchStyle;
  const brollStyle = settings.brollStyle?.toLowerCase() ?? "";
  const editStyle = settings.editStyle?.toLowerCase() ?? "";
  const editGoal = settings.editGoal?.toLowerCase() ?? "";
  const brandNotes = settings.brandNotes?.toLowerCase() ?? "";
  const searchTokens = new Set(tokenize(profile.searchText));
  const expandedKeywords = expandVisualKeywords(beat.keywords, beat.visualIntent);
  const keywordMatches = expandedKeywords.filter((keyword) => searchTokens.has(keyword)).length;
  const literalScore = Math.min(0.58, keywordMatches / Math.max(4, beat.keywords.length));
  const moodMatches = profile.moodTags.filter((tag) => tag === beat.emotionalTone || beat.text.toLowerCase().includes(tag)).length;
  const emotionalScore = Math.min(0.34, moodMatches * 0.12 + (profile.moodTags.length ? 0.04 : 0));
  const roleScore = profile.roleTags?.includes(beat.editorialRole) ? 0.12 : 0;
  const styleScore =
    profile.visualStyle && beat.visualMode !== "face-time"
      ? profile.visualStyle === beat.visualMode || (beat.visualMode === "style" && profile.visualStyle === "background")
        ? 0.1
        : 0
      : 0;
  const mediaPreferenceScore =
    beat.preferVideo && profile.mediaType === "video"
      ? 0.1
      : !beat.preferVideo && profile.mediaType === "image"
        ? 0.035
        : 0;
  const brollStyleScore =
    brollStyle.includes("literal") && profile.visualStyle === "literal"
      ? 0.1
      : brollStyle.includes("metaphorical") && profile.visualStyle === "metaphorical"
        ? 0.1
        : brollStyle.includes("stock") && profile.mediaType === "video"
          ? 0.08
          : brollStyle.includes("generated") && (profile.visualStyle === "background" || profile.visualStyle === "texture")
            ? 0.06
            : brollStyle.includes("minimal") && profile.visualStyle === "overlay"
              ? 0.04
              : 0;
  const editStyleScore =
    (editStyle.includes("fast") || editStyle.includes("high-energy")) && profile.mediaType === "video"
      ? 0.08
      : (editStyle.includes("luxury") || editStyle.includes("premium")) && (profile.visualStyle === "background" || profile.motionEnergy === "gentle")
        ? 0.06
        : editStyle.includes("podcast") && profile.visualStyle === "overlay"
          ? 0.04
          : 0;
  const goalScore =
    editGoal.includes("sales") && /product|payment|checkout|offer|demo|client|result/.test(profile.searchText)
      ? 0.07
      : editGoal.includes("leads") && /call|calendar|quiz|training|webinar|lead|crm/.test(profile.searchText)
        ? 0.07
        : editGoal.includes("education") && /screen|steps|tutorial|checklist|process|diagram/.test(profile.searchText)
          ? 0.06
          : editGoal.includes("authority") && /speaking|podcast|office|founder|client|proof/.test(profile.searchText)
            ? 0.06
            : 0;
  const brandScore =
    brandNotes.includes("premium") && (profile.visualStyle === "background" || profile.motionEnergy === "gentle")
      ? 0.04
      : brandNotes.includes("ugc") && profile.motionEnergy === "active"
        ? 0.04
        : 0;
  const faceTimePenalty = beat.visualMode === "face-time" && brollStyle.includes("minimal") ? 0.2 : 0;
  const profileConfidence = profile.confidence * 0.18;

  if (matchStyle === "literal") {
    return clampScore(literalScore + roleScore + mediaPreferenceScore + brollStyleScore + editStyleScore + goalScore + brandScore + profileConfidence - faceTimePenalty);
  }
  if (matchStyle === "emotional" || matchStyle === "metaphorical") {
    return clampScore(emotionalScore + styleScore + roleScore + mediaPreferenceScore + brollStyleScore + editStyleScore + goalScore + brandScore + profileConfidence + literalScore * 0.35 - faceTimePenalty);
  }

  return clampScore(literalScore + emotionalScore + roleScore + styleScore + mediaPreferenceScore + brollStyleScore + editStyleScore + goalScore + brandScore + profileConfidence - faceTimePenalty);
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
  const matchKind =
    profile.visualStyle === beat.visualMode
      ? beat.visualMode
      : profile.roleTags?.includes(beat.editorialRole)
        ? beat.editorialRole
        : beat.emotionalTone;
  const mediaFit = beat.preferVideo && profile.mediaType === "video" ? " Video is preferred for this moving/energy beat." : "";
  return `Matched "${profile.name}" to ${beat.editorialRole} ${beat.visualMode} beat "${beat.text.slice(0, 80)}" with ${(score * 100).toFixed(0)}% fit. Reason: ${matchKind} fit plus ${profile.mediaType} ${profile.motionEnergy} media.${mediaFit}${reuseNote}`;
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

function inferEditorialRole(
  text: string,
  segmentIndex: number,
  beatIndex: number,
): ScriptBeat["editorialRole"] {
  const lowered = text.toLowerCase();
  if ((segmentIndex === 0 || beatIndex === 0) && /(\?|stop|wait|mistake|secret|truth|nobody|why|how|this is)/.test(lowered)) {
    return "hook";
  }
  if (/\b(comment|dm|click|subscribe|follow|book|buy|send|link|quiz|training|call to action)\b/.test(lowered)) {
    return "cta";
  }
  if (/\b(proof|result|case study|because|data|numbers|client|testimonial|evidence|revenue|dashboard)\b/.test(lowered)) {
    return "proof";
  }
  if (/\b(but|however|meanwhile|then|next|now|so)\b/.test(lowered) && text.split(/\s+/).length < 16) {
    return "transition";
  }
  if (/\b(how|why|step|process|explain|learn|because|means|allows)\b/.test(lowered)) {
    return "explanation";
  }
  return "general";
}

function inferVisualIntent(text: string, settings: DynamicEditorSettings): string {
  const lowered = text.toLowerCase();
  const direction = [
    settings.editGoal,
    settings.editStyle,
    settings.brollStyle,
    settings.captionStyle,
    settings.ctaContext,
    settings.creativeDirection,
    settings.brandNotes,
  ]
    .filter(Boolean)
    .join(" | ");
  if (/\b(money|sales|revenue|profit|payment|cash|income)\b/.test(lowered)) {
    return `business money outcome: dashboard, payment, laptop work, client result, premium finance visual. Direction: ${direction}`;
  }
  if (/\b(travel|airport|plane|cafe|beach|hotel|remote)\b/.test(lowered)) {
    return `location freedom: airport, cafe remote work, travel transition, laptop in destination. Direction: ${direction}`;
  }
  if (/\b(client|lead|customer|call|book|quiz|training)\b/.test(lowered)) {
    return `conversion proof: client call, lead form, calendar booking, training screen, CRM/dashboard. Direction: ${direction}`;
  }
  if (/\b(stress|fear|risk|mistake|problem)\b/.test(lowered)) {
    return `problem tension: worried face, messy desk, warning detail, dark contrast. Direction: ${direction}`;
  }
  if (/\b(step|process|system|framework|how)\b/.test(lowered)) {
    return `explanation support: hands, screen, diagram, checklist, clean workspace. Direction: ${direction}`;
  }
  return `support the spoken idea with literal or emotionally aligned B-roll. Direction: ${direction}`;
}

function inferVisualMode(text: string, settings: DynamicEditorSettings): ScriptBeat["visualMode"] {
  const lowered = text.toLowerCase();
  const brollStyle = settings.brollStyle?.toLowerCase() ?? "";
  const creativeDirection = settings.creativeDirection?.toLowerCase() ?? "";
  if (brollStyle.includes("minimal")) {
    return "face-time";
  }
  if (brollStyle.includes("literal")) {
    return "literal";
  }
  if (brollStyle.includes("metaphorical")) {
    return "metaphorical";
  }
  if (brollStyle.includes("stock") || brollStyle.includes("generated")) {
    return creativeDirection.includes("subtle") || settings.editStyle?.toLowerCase().includes("luxury") ? "style" : "literal";
  }
  if (/\b(I|me|my story|honest|truth)\b/.test(text) && text.split(/\s+/).length < 12) {
    return "face-time";
  }
  if (settings.matchStyle === "metaphorical" || /\b(feels like|imagine|freedom|stuck|pressure)\b/.test(lowered)) {
    return "metaphorical";
  }
  if (settings.matchStyle === "emotional") {
    return "style";
  }
  return "literal";
}

function inferPreferVideo(text: string, settings: DynamicEditorSettings): boolean {
  const brollStyle = settings.brollStyle?.toLowerCase() ?? "";
  const editStyle = settings.editStyle?.toLowerCase() ?? "";
  if (brollStyle.includes("minimal")) {
    return false;
  }
  if (brollStyle.includes("stock") || editStyle.includes("fast") || editStyle.includes("high-energy")) {
    return true;
  }
  if (editStyle.includes("luxury") || editStyle.includes("premium")) {
    return /\b(travel|walk|move|show|demonstrate|scroll|dashboard|payment|call|work)\b/i.test(text);
  }
  return settings.pacingPreset === "social-fast" || /\b(travel|walk|move|show|demonstrate|scroll|dashboard|payment|call|work)\b/i.test(text);
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
  return tags.size > 0 ? Array.from(tags) : ["neutral"];
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

function inferRoleTags(tokens: string[]): AssetSemanticProfile["roleTags"] {
  const tags = new Set<NonNullable<AssetSemanticProfile["roleTags"]>[number]>();
  if (tokens.some((token) => ["hook", "dramatic", "attention", "face", "close"].includes(token))) tags.add("hook");
  if (tokens.some((token) => ["screen", "diagram", "desk", "process", "tool", "laptop"].includes(token))) tags.add("explanation");
  if (tokens.some((token) => ["result", "dashboard", "payment", "client", "testimonial", "proof"].includes(token))) tags.add("proof");
  if (tokens.some((token) => ["transition", "walk", "travel", "city", "move"].includes(token))) tags.add("transition");
  if (tokens.some((token) => ["cta", "comment", "phone", "message", "link", "form"].includes(token))) tags.add("cta");
  return tags.size > 0 ? Array.from(tags) : ["general"];
}

function inferVisualStyle(tokens: string[], mediaType: MediaLibraryItem["type"]): NonNullable<AssetSemanticProfile["visualStyle"]> {
  if (tokens.some((token) => ["texture", "pattern", "abstract", "gradient"].includes(token))) return "texture";
  if (tokens.some((token) => ["overlay", "phone", "screen", "caption"].includes(token))) return "overlay";
  if (tokens.some((token) => ["background", "ambient", "broll", "slow"].includes(token))) return "background";
  if (tokens.some((token) => ["symbolic", "shadow", "freedom", "stress", "journey"].includes(token))) return "metaphorical";
  if (mediaType === "video" || tokens.length > 0) return "literal";
  return "unknown";
}

function expandVisualKeywords(keywords: string[], visualIntent: string): string[] {
  const expanded = new Set(keywords);
  const intent = visualIntent.toLowerCase();
  if (intent.includes("money")) {
    ["money", "payment", "dashboard", "laptop", "business", "finance", "client", "revenue"].forEach((token) => expanded.add(token));
  }
  if (intent.includes("travel")) {
    ["travel", "airport", "cafe", "remote", "laptop", "plane", "hotel", "work"].forEach((token) => expanded.add(token));
  }
  if (intent.includes("conversion")) {
    ["client", "lead", "call", "calendar", "form", "training", "crm", "dashboard"].forEach((token) => expanded.add(token));
  }
  if (intent.includes("explanation")) {
    ["screen", "hands", "checklist", "desk", "diagram", "tool", "workspace"].forEach((token) => expanded.add(token));
  }
  return Array.from(expanded);
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
