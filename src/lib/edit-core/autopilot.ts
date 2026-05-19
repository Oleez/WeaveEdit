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
import { buildEditPlan } from "./plan-builder";
import { ChatEditIntent, EditAction, EditPlan } from "./types";

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

export function replanFromIntent(plan: EditPlan, intent: ChatEditIntent): EditPlan {
  const actions: EditAction[] = [];
  const visualPlacements = plan.actions.filter((action) => action.kind === "place_clip");

  intent.ops.forEach((op) => {
    if (op.kind === "punch_in") {
      visualPlacements
        .filter((action) => action.kind === "place_clip")
        .slice(0, 6)
        .forEach((action) => {
          actions.push({
            kind: "punch_in",
            placementId: action.placementId,
            scalePct: typeof op.value === "number" ? op.value : 112,
            durationSec: Math.min(1.2, Math.max(0.35, action.endSec - action.startSec)),
          });
        });
    }

    if (op.kind === "audio_polish") {
      actions.push({ kind: "normalize_loudness", trackIndex: 0, targetLufs: -14 });
      actions.push({ kind: "duck_under_voice", musicTrackIndex: 1, voiceTrackIndex: 0, duckDb: -9 });
    }

    if (op.kind === "transitions") {
      visualPlacements
        .filter((action) => action.kind === "place_clip")
        .slice(1, 10)
        .forEach((action) => {
          actions.push({
            kind: "add_transition",
            placementId: action.placementId,
            style: "cross_dissolve",
            durationSec: 0.25,
          });
        });
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
      {
        agent: "chat-router",
        claim: `Converted "${intent.rawText}" into ${actions.length} preview actions.`,
        evidence: intent.ops.map((op) => op.kind),
        confidence: actions.length > 0 ? 0.78 : 0.38,
      },
    ],
  };
}
