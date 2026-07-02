import { TimelinePlacement, buildTimelinePlan } from "@/lib/timeline-plan";
import { ScriptSegment } from "@/lib/script-parser";
import { MediaLibraryItem } from "@/lib/media";
import { SilenceSpan } from "@/lib/cep";
import {
  AiSegmentRanking,
  EditorPacingPreset,
  PlacementStrategyMode,
} from "@/lib/ai/types";
import { AgentContext } from "@/lib/ai/agents/shared";
import { analyzeAudio } from "@/lib/ai/agents/audio";
import { reviewContinuity } from "@/lib/ai/agents/continuity";
import { critiquePlan } from "@/lib/ai/agents/critic";
import { directEdit } from "@/lib/ai/agents/director";
import { reviewPacing } from "@/lib/ai/agents/pacing";
import { buildCaptionRunAction, buildEditPlan } from "./plan-builder";
import { AgentDeliberation, ChatEditIntent, EditAction, EditPlan } from "./types";

export interface AutopilotInput {
  placements: TimelinePlacement[];
  targetVideoTrackIndex: number;
  targetAudioTrackIndex: number;
  targetLufs?: number;
  agentContext?: AgentContext;
}

/**
 * Higher-level "one button" input that drives the full ingest -> silence ->
 * b-roll -> audio -> captions -> critic pipeline. Everything is data-in so the
 * orchestrator is fully testable outside the CEP runtime; the caller fetches
 * markers, scans media, runs silence preview, then hands the data here.
 */
export interface FullAutopilotInput {
  segments: ScriptSegment[];
  mediaItems: MediaLibraryItem[];
  silenceSpans?: SilenceSpan[];
  targetVideoTrackIndex: number;
  targetAudioTrackIndex: number;
  targetLufs?: number;
  agentContext?: AgentContext;
  aiRankingsBySegmentId?: Record<string, AiSegmentRanking>;
  manualOverridesBySegmentId?: Record<string, string | "blank" | "auto">;
  aiConfidenceThreshold?: number;
  pacingPreset?: EditorPacingPreset;
  placementStrategyMode?: PlacementStrategyMode;
  variationStrength?: number;
  averageShotLengthSec?: number;
  minClipDurationSec?: number;
  maxClipDurationSec?: number;
  frameRate?: number;
  sequenceEndSec?: number;
  rangeStartSec?: number | null;
  rangeEndSec?: number | null;
}

export interface FullAutopilotResult {
  plan: EditPlan;
  placements: TimelinePlacement[];
  diagnostics: {
    ingestedSegments: number;
    mediaScanned: number;
    silenceSpansApplied: number;
    visualPlacements: number;
    blankPlacements: number;
    rationaleCount: number;
  };
}

export async function runAutopilot(input: AutopilotInput): Promise<EditPlan> {
  const basePlan = buildEditPlan({
    placements: input.placements,
    targetVideoTrackIndex: input.targetVideoTrackIndex,
    targetAudioTrackIndex: input.targetAudioTrackIndex,
  });

  const council = await Promise.all([
    directEdit(basePlan, input, input.agentContext),
    reviewPacing(basePlan, input.agentContext),
    reviewContinuity(basePlan, input.agentContext),
    analyzeAudio(
      basePlan,
      { targetAudioTrackIndex: input.targetAudioTrackIndex, targetLufs: input.targetLufs ?? -14 },
      input.agentContext,
    ),
  ]);
  const critic = await critiquePlan(basePlan, input.agentContext);

  return {
    ...basePlan,
    id: `autopilot-${basePlan.id}`,
    actions: [...basePlan.actions, ...council.flatMap((result) => result.actions)],
    rationale: [...basePlan.rationale, ...council.flatMap((result) => result.rationale), ...critic.rationale],
  };
}

/**
 * The eight-step pipeline from the master plan:
 *   1. ingest (segments + media in)
 *   2. silence pass (spans -> cut_silence action)
 *   3. story / b-roll assembly (buildTimelinePlan)
 *   4. audio polish (normalize + duck)
 *   5. captions (already produced by plan-builder)
 *   6. agent council (director / pacing / continuity / audio / critic)
 *   7. critic gate (returns rationale; UI uses confidence to decide warnings)
 *   8. preview-only output (caller renders diff; nothing touches Premiere yet)
 */
export async function runFullAutopilot(input: FullAutopilotInput): Promise<FullAutopilotResult> {
  const minDuration = Math.max(0.5, input.minClipDurationSec ?? 2);
  const maxDuration = Math.max(minDuration, input.maxClipDurationSec ?? 8);
  const frameRate = input.frameRate ?? 30;
  const pacing = input.pacingPreset ?? "documentary";

  // 3. Story / b-roll assembly. Uses the same deterministic planner that powers the
  //    legacy dashboard so behavior is consistent and the new pipeline can stand
  //    in for the manual flow without surprises.
  const baseTimeline = buildTimelinePlan(input.segments, input.mediaItems, {
    minDurationSec: minDuration,
    maxDurationSec: maxDuration,
    blankWhenNoImage: true,
    aiRankingsBySegmentId: input.aiRankingsBySegmentId,
    manualOverridesBySegmentId: input.manualOverridesBySegmentId,
    aiConfidenceThreshold: input.aiConfidenceThreshold,
    allowLowConfidenceFallback: true,
    maxOverlapLayers: pacing === "cinematic-slow" ? 1 : 2,
    frameRate,
    sequenceEndSec: input.sequenceEndSec,
    rangeStartSec: input.rangeStartSec ?? null,
    rangeEndSec: input.rangeEndSec ?? null,
    targetSecondsPerClip: input.averageShotLengthSec ?? 4,
    placementStrategyMode: input.placementStrategyMode,
    variationStrength: input.variationStrength,
    editorPacingPreset: pacing,
  });

  // 4-5. Build the EditPlan; plan-builder emits place_clip actions, optional
  //      cut_silence, and a word-timed caption run from transcript text.
  const basePlan = buildEditPlan({
    placements: baseTimeline.placements,
    silenceSpans: input.silenceSpans ?? [],
    targetVideoTrackIndex: input.targetVideoTrackIndex,
    targetAudioTrackIndex: input.targetAudioTrackIndex,
  });

  // 6. Council deliberation. Each agent appends rationale (LLM-driven when an
  //    AgentContext is supplied, deterministic fallback otherwise) and may
  //    produce additional actions (punch_in / normalize_loudness / etc.).
  const council = await Promise.all([
    directEdit(basePlan, { placements: baseTimeline.placements }, input.agentContext),
    reviewPacing(basePlan, input.agentContext),
    reviewContinuity(basePlan, input.agentContext),
    analyzeAudio(
      basePlan,
      { targetAudioTrackIndex: input.targetAudioTrackIndex, targetLufs: input.targetLufs ?? -14 },
      input.agentContext,
    ),
  ]);

  // 7. Critic gate.
  const critic = await critiquePlan(basePlan, input.agentContext);

  const visualPlacements = baseTimeline.placements.filter((placement) => placement.mediaPath);
  const blanks = baseTimeline.placements.length - visualPlacements.length;

  const plan: EditPlan = {
    ...basePlan,
    id: `autopilot-full-${basePlan.id}`,
    actions: [...basePlan.actions, ...council.flatMap((result) => result.actions)],
    rationale: [
      ...basePlan.rationale,
      {
        agent: "director",
        claim: `Autopilot pipeline assembled ${baseTimeline.placements.length} placements from ${input.segments.length} segments and ${input.mediaItems.length} media items.`,
        evidence: [
          `silence spans: ${input.silenceSpans?.length ?? 0}`,
          `visual coverage: ${visualPlacements.length}`,
          `blanks: ${blanks}`,
          `pacing: ${pacing}`,
        ],
        confidence: visualPlacements.length > 0 ? 0.86 : 0.4,
      },
      ...council.flatMap((result) => result.rationale),
      ...critic.rationale,
    ],
  };

  return {
    plan,
    placements: baseTimeline.placements,
    diagnostics: {
      ingestedSegments: input.segments.length,
      mediaScanned: input.mediaItems.length,
      silenceSpansApplied: input.silenceSpans?.length ?? 0,
      visualPlacements: visualPlacements.length,
      blankPlacements: blanks,
      rationaleCount: plan.rationale.length,
    },
  };
}

export interface ReplanOptions {
  /** AI rankings from "Analyze with AI"; used by replace_broll to pick next-best assets. */
  rankingsBySegmentId?: Record<string, AiSegmentRanking>;
  /** Media library items; resolves ranked candidateIds (paths) back to name/type. */
  mediaItems?: MediaLibraryItem[];
}

type PlaceClipAction = Extract<EditAction, { kind: "place_clip" }>;

export function replanFromIntent(plan: EditPlan, intent: ChatEditIntent, options: ReplanOptions = {}): EditPlan {
  const actions: EditAction[] = [];
  const rationale: AgentDeliberation[] = [];
  const placeClips = plan.actions.filter((action): action is PlaceClipAction => action.kind === "place_clip");
  const visualClips = placeClips.filter((action) => action.mediaPath);

  intent.ops.forEach((op) => {
    if (op.kind === "tighten") {
      const minSilenceSec = typeof op.value === "number" ? op.value : 0.2;
      const existingSpans = plan.actions
        .filter((action): action is Extract<EditAction, { kind: "cut_silence" }> => action.kind === "cut_silence")
        .flatMap((action) => action.spans);
      const tightened = existingSpans.filter((span) => span.durationSec >= minSilenceSec);
      if (tightened.length > 0) {
        actions.push({ kind: "cut_silence", spans: tightened, audioTrackIndex: 0 });
        rationale.push({
          agent: "chat-router",
          claim: `Tightening pacing: re-cutting ${tightened.length} silence gap(s) of ${minSilenceSec}s or longer.`,
          evidence: tightened.slice(0, 5).map((span) => `${span.startSec.toFixed(1)}s (${span.durationSec.toFixed(2)}s gap)`),
          confidence: 0.8,
        });
      } else {
        rationale.push({
          agent: "chat-router",
          claim:
            "No silence analysis is in this plan yet, so there is nothing to tighten. Run Autopilot (or the silence preview) first and I can cut the gaps.",
          evidence: ["tighten requested", "0 silence spans available"],
          confidence: 0.4,
        });
      }
    }

    if (op.kind === "punch_in") {
      visualClips.slice(0, 6).forEach((action) => {
        actions.push({
          kind: "punch_in",
          placementId: action.placementId,
          scalePct: typeof op.value === "number" ? op.value : 112,
          durationSec: Math.min(1.2, Math.max(0.35, action.endSec - action.startSec)),
        });
      });
      rationale.push({
        agent: "chat-router",
        claim: `Added punch-in zooms on ${Math.min(6, visualClips.length)} clip(s) to add emphasis.`,
        evidence: visualClips.slice(0, 6).map((action) => action.placementId),
        confidence: visualClips.length > 0 ? 0.78 : 0.4,
      });
    }

    if (op.kind === "captions") {
      const placements = placeClips
        .map((action) => action.placement)
        .filter((placement): placement is TimelinePlacement => Boolean(placement && placement.text));
      if (placements.length > 0) {
        actions.push(buildCaptionRunAction(placements));
        rationale.push({
          agent: "chat-router",
          claim: `Built a word-timed caption run covering ${placements.length} placement(s).`,
          evidence: [`${placements.length} placements with transcript text`],
          confidence: 0.82,
        });
      } else {
        rationale.push({
          agent: "chat-router",
          claim: "No placements with transcript text are in the plan yet, so captions have nothing to time against. Run Autopilot first.",
          evidence: ["captions requested", "0 text placements"],
          confidence: 0.4,
        });
      }
    }

    if (op.kind === "audio_polish") {
      actions.push({ kind: "normalize_loudness", trackIndex: 0, targetLufs: -14 });
      actions.push({ kind: "duck_under_voice", musicTrackIndex: 1, voiceTrackIndex: 0, duckDb: -9 });
      rationale.push({
        agent: "chat-router",
        claim: "Queued audio polish: normalize the voice track to -14 LUFS and duck music -9 dB under speech.",
        evidence: ["normalize_loudness", "duck_under_voice"],
        confidence: 0.8,
      });
    }

    if (op.kind === "transitions") {
      const targets = visualClips.slice(1, 10);
      targets.forEach((action) => {
        actions.push({
          kind: "add_transition",
          placementId: action.placementId,
          style: "cross_dissolve",
          durationSec: 0.25,
        });
      });
      rationale.push({
        agent: "chat-router",
        claim: `Added ${targets.length} cross-dissolve transition(s) between visual clips.`,
        evidence: targets.map((action) => action.placementId),
        confidence: targets.length > 0 ? 0.76 : 0.4,
      });
    }

    if (op.kind === "color_match") {
      const reference = visualClips[0]?.mediaPath ?? null;
      if (reference && visualClips.length > 1) {
        const targets = visualClips.slice(1, 13);
        targets.forEach((action) => {
          actions.push({ kind: "color_match", placementId: action.placementId, referencePath: reference });
        });
        rationale.push({
          agent: "chat-router",
          claim: `Matching the color of ${targets.length} clip(s) to the opening clip's look.`,
          evidence: [`reference: ${reference}`],
          confidence: 0.74,
        });
      } else {
        rationale.push({
          agent: "chat-router",
          claim: "Color match needs at least two visual clips in the plan — run Autopilot or place B-roll first.",
          evidence: [`visual clips available: ${visualClips.length}`],
          confidence: 0.4,
        });
      }
    }

    if (op.kind === "replace_broll") {
      const replacements = buildBrollReplacements(visualClips, options);
      if (replacements.actions.length > 0) {
        actions.push(...replacements.actions);
        rationale.push({
          agent: "chat-router",
          claim: `Swapped ${replacements.actions.length} weak B-roll clip(s) for the next-best AI-ranked asset.`,
          evidence: replacements.evidence,
          confidence: 0.72,
        });
      } else {
        rationale.push({
          agent: "chat-router",
          claim:
            replacements.evidence.length > 0
              ? "The weak clips have no alternative ranked assets to swap in. Run \"Analyze with AI\" to rank your media library first."
              : "No weak B-roll found to replace — every visual clip is above the confidence bar.",
          evidence: replacements.evidence,
          confidence: 0.4,
        });
      }
    }
  });

  return {
    ...plan,
    id: `chat-${Date.now().toString(36)}`,
    basedOnPlanId: plan.id,
    diffFrom: plan,
    actions: [...plan.actions, ...actions],
    rationale: [
      ...plan.rationale,
      ...rationale,
      {
        agent: "chat-router",
        claim: `Converted "${intent.rawText}" into ${actions.length} preview actions.`,
        evidence: intent.ops.map((op) => op.kind),
        confidence: actions.length > 0 ? 0.78 : 0.38,
      },
    ],
  };
}

function buildBrollReplacements(
  visualClips: PlaceClipAction[],
  options: ReplanOptions,
): { actions: EditAction[]; evidence: string[] } {
  const evidence: string[] = [];
  const actions: EditAction[] = [];

  const weak = visualClips
    .filter((action) => action.placement && (action.placement.lowConfidence || action.placement.aiConfidence < 0.55))
    .sort((a, b) => (a.placement?.aiConfidence ?? 0) - (b.placement?.aiConfidence ?? 0))
    .slice(0, 6);

  if (weak.length === 0) {
    return { actions, evidence };
  }

  const mediaByPath = new Map(
    (options.mediaItems ?? []).map((item) => [normalizeMediaPath(item.path), item] as const),
  );

  for (const action of weak) {
    const placement = action.placement;
    if (!placement) continue;
    evidence.push(`${placement.id} (confidence ${Math.round(placement.aiConfidence * 100)}%)`);

    const ranking = options.rankingsBySegmentId?.[placement.segmentId];
    if (!ranking) continue;

    const currentPath = normalizeMediaPath(placement.mediaPath ?? "");
    const nextBest = [...ranking.rankedAssets]
      .sort((a, b) => b.score - a.score)
      .find((ranked) => normalizeMediaPath(ranked.candidateId) !== currentPath);
    if (!nextBest) continue;

    const media = mediaByPath.get(normalizeMediaPath(nextBest.candidateId));
    const newPath = media?.path ?? nextBest.candidateId;
    actions.push({
      kind: "place_clip",
      placementId: placement.id,
      track: action.track,
      startSec: action.startSec,
      endSec: action.endSec,
      mediaPath: newPath,
      placement: {
        ...placement,
        mediaPath: newPath,
        mediaName: media?.name ?? newPath.split(/[\\/]/).pop() ?? newPath,
        mediaType: media?.type ?? placement.mediaType,
        aiConfidence: nextBest.score,
        aiRationale: nextBest.rationale || placement.aiRationale,
        lowConfidence: false,
        strategy: "ai",
      },
    });
  }

  return { actions, evidence };
}

function normalizeMediaPath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}
