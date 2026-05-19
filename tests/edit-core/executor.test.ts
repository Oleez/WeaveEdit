import { describe, expect, it } from "vitest";
import { buildTimelineJobPayload } from "../../src/lib/edit-core/executor";
import { EditAction } from "../../src/lib/edit-core/types";

describe("buildTimelineJobPayload", () => {
  it("translates place_clip actions into Premiere timeline job placements", () => {
    const actions: EditAction[] = [
      {
        kind: "place_clip",
        placementId: "p1",
        track: "V1",
        startSec: 2,
        endSec: 5,
        mediaPath: "C:/media/clip.mp4",
        placement: {
          id: "p1",
          groupId: "g1",
          segmentId: "s1",
          layerIndex: 0,
          trackOffset: 0,
          startSec: 2,
          endSec: 5,
          durationSec: 3,
          strategy: "ai",
          mediaPath: "C:/media/clip.mp4",
          mediaName: "clip.mp4",
          mediaType: "video",
          text: "proof beat",
          keywordScore: 0.8,
          aiConfidence: 0.9,
          aiRationale: null,
          aiVisualMatchReason: null,
          matchKind: null,
          mediaPreference: null,
          aiProvider: null,
          lowConfidence: false,
          fallbackReason: null,
          timingSource: "ai",
          timingRationale: null,
          overlapStyle: "single",
          editorialRole: "proof",
          sourceInSec: 0.5,
          sourceOutSec: 3.5,
          sourceDurationSec: 6,
          trimApplied: true,
          trimNote: null,
        },
      },
      { kind: "normalize_loudness", trackIndex: 0, targetLufs: -14 },
    ];

    const payload = buildTimelineJobPayload(actions, {
      targetVideoTrackIndex: 1,
      appendAtTrackEnd: false,
      useSequenceInOut: true,
      rangeStartSec: 0,
      rangeEndSec: 10,
    });

    expect(payload).toMatchObject({
      targetVideoTrackIndex: 1,
      appendAtTrackEnd: false,
      useSequenceInOut: true,
      rangeStartSec: 0,
      rangeEndSec: 10,
    });
    expect(payload.placements).toEqual([
      expect.objectContaining({
        id: "p1",
        mediaPath: "C:/media/clip.mp4",
        durationSec: 3,
        sourceInSec: 0.5,
        sourceOutSec: 3.5,
        strategy: "ai",
      }),
    ]);
  });
});
