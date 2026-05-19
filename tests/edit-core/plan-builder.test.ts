import { describe, expect, it } from "vitest";
import { buildEditPlan } from "../../src/lib/edit-core/plan-builder";

describe("buildEditPlan", () => {
  it("converts timeline placements into previewable place_clip actions", () => {
    const plan = buildEditPlan({
      targetVideoTrackIndex: 1,
      targetAudioTrackIndex: 0,
      placements: [
        {
          id: "p1",
          groupId: "g1",
          segmentId: "s1",
          layerIndex: 0,
          trackOffset: 0,
          startSec: 1,
          endSec: 4,
          durationSec: 3,
          strategy: "ai",
          mediaPath: "C:/clip.mp4",
          mediaName: "clip.mp4",
          mediaType: "video",
          text: "hello world",
          keywordScore: 1,
          aiConfidence: 0.9,
          aiRationale: null,
          aiVisualMatchReason: null,
          matchKind: null,
          mediaPreference: null,
          aiProvider: null,
          lowConfidence: false,
          fallbackReason: null,
          timingSource: "segment",
          timingRationale: null,
          overlapStyle: "single",
          editorialRole: "hook",
          sourceInSec: null,
          sourceOutSec: null,
          sourceDurationSec: null,
          trimApplied: false,
          trimNote: null,
        },
      ],
    });

    expect(plan.actions[0]).toMatchObject({
      kind: "place_clip",
      placementId: "p1",
      track: "V2",
      startSec: 1,
      endSec: 4,
    });
    expect(plan.actions.some((action) => action.kind === "add_caption_run")).toBe(true);
  });
});
