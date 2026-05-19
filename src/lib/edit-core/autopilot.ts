import { TimelinePlacement } from "@/lib/timeline-plan";
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
  creatorProfileSummary?: string;
}

export async function runAutopilot(input: AutopilotInput): Promise<EditPlan> {
  const basePlan = buildEditPlan({
    placements: input.placements,
    targetVideoTrackIndex: input.targetVideoTrackIndex,
    targetAudioTrackIndex: input.targetAudioTrackIndex,
  });

  const council = await Promise.all([
    directEdit(basePlan, input),
    reviewPacing(basePlan),
    reviewContinuity(basePlan),
    analyzeAudio(basePlan, { targetAudioTrackIndex: input.targetAudioTrackIndex, targetLufs: input.targetLufs ?? -14 }),
  ]);
  const critic = await critiquePlan(basePlan);

  return {
    ...basePlan,
    id: `autopilot-${basePlan.id}`,
    actions: [...basePlan.actions, ...council.flatMap((result) => result.actions)],
    rationale: [...basePlan.rationale, ...council.flatMap((result) => result.rationale), ...critic.rationale],
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
