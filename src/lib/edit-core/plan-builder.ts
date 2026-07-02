import { SilenceSpan } from "@/lib/cep";
import { TimelinePlacement } from "@/lib/timeline-plan";
import { EditAction, EditPlan } from "./types";

export interface BuildEditPlanInput {
  placements: TimelinePlacement[];
  silenceSpans?: SilenceSpan[];
  targetVideoTrackIndex?: number;
  targetAudioTrackIndex?: number;
  captionTrack?: string;
}

export function buildEditPlan({
  placements,
  silenceSpans = [],
  targetVideoTrackIndex = 0,
  targetAudioTrackIndex = 0,
  captionTrack = "C1",
}: BuildEditPlanInput): EditPlan {
  const actions: EditAction[] = placements.map((placement) => ({
    kind: "place_clip",
    placementId: placement.id,
    track: `V${targetVideoTrackIndex + 1 + (placement.trackOffset ?? 0)}`,
    startSec: roundTime(placement.startSec),
    endSec: roundTime(placement.endSec),
    mediaPath: placement.mediaPath,
    placement,
  }));

  if (silenceSpans.length > 0) {
    actions.push({
      kind: "cut_silence",
      spans: silenceSpans,
      audioTrackIndex: targetAudioTrackIndex,
    });
  }

  actions.push(buildCaptionRunAction(placements, captionTrack));

  return {
    id: createPlanId("plan"),
    createdAt: new Date().toISOString(),
    actions,
    rationale: [
      {
        agent: "director",
        claim: "Built a previewable edit plan from timeline placements and transcript timing.",
        evidence: [`${placements.length} visual placements`, `${silenceSpans.length} silence spans`],
        confidence: placements.length > 0 ? 0.82 : 0.45,
      },
    ],
  };
}

export function createPlanId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Word-timed caption run from placement text. Shared by the initial plan build
 * and the chat "add captions" command so both produce identical caption data.
 */
export function buildCaptionRunAction(
  placements: TimelinePlacement[],
  captionTrack = "C1",
  style: Extract<EditAction, { kind: "add_caption_run" }>["style"] = { preset: "clean-bold", position: "lower" },
): Extract<EditAction, { kind: "add_caption_run" }> {
  return {
    kind: "add_caption_run",
    track: captionTrack,
    style,
    words: placements.flatMap((placement) => wordsFromPlacement(placement)),
  };
}

function wordsFromPlacement(placement: TimelinePlacement) {
  const tokens = placement.text.split(/\s+/).filter(Boolean).slice(0, 18);
  const duration = Math.max(0.2, placement.endSec - placement.startSec);
  const step = duration / Math.max(1, tokens.length);

  return tokens.map((word, index) => ({
    word,
    startSec: roundTime(placement.startSec + step * index),
    endSec: roundTime(placement.startSec + step * (index + 1)),
  }));
}

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}
