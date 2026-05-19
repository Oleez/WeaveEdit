import { describe, expect, it } from "vitest";
import { runFullAutopilot } from "@/lib/edit-core/autopilot";
import type { ScriptSegment } from "@/lib/script-parser";
import type { MediaLibraryItem } from "@/lib/media";

const segments: ScriptSegment[] = [
  {
    id: "seg-1",
    startSec: 0,
    endSec: 4,
    text: "Opening hook about the city skyline at sunrise.",
    wordCount: 9,
    sentenceCount: 1,
    sentenceComplete: true,
    sentenceBoundaryConfidence: 0.9,
  },
  {
    id: "seg-2",
    startSec: 4,
    endSec: 8,
    text: "Close-up on people walking on busy streets downtown.",
    wordCount: 10,
    sentenceCount: 1,
    sentenceComplete: true,
    sentenceBoundaryConfidence: 0.9,
  },
  {
    id: "seg-3",
    startSec: 8,
    endSec: 12,
    text: "Final cta about the partnership opportunity.",
    wordCount: 7,
    sentenceCount: 1,
    sentenceComplete: true,
    sentenceBoundaryConfidence: 0.9,
  },
];

const mediaItems: MediaLibraryItem[] = [
  {
    name: "skyline_sunrise.jpg",
    path: "/media/skyline_sunrise.jpg",
    type: "image",
    extension: ".jpg",
    createdMs: 1,
    modifiedMs: 1,
    folderIndex: 0,
    sortKey: 0,
  },
  {
    name: "downtown_streets.mp4",
    path: "/media/downtown_streets.mp4",
    type: "video",
    extension: ".mp4",
    createdMs: 2,
    modifiedMs: 2,
    folderIndex: 1,
    sortKey: 1,
  },
  {
    name: "partnership_handshake.jpg",
    path: "/media/partnership_handshake.jpg",
    type: "image",
    extension: ".jpg",
    createdMs: 3,
    modifiedMs: 3,
    folderIndex: 2,
    sortKey: 2,
  },
];

describe("runFullAutopilot", () => {
  it("produces a council-deliberated plan from segments + media in one call", async () => {
    const result = await runFullAutopilot({
      segments,
      mediaItems,
      silenceSpans: [
        { startSec: 0.8, endSec: 1.2, durationSec: 0.4, peakDb: -42 },
      ],
      targetVideoTrackIndex: 1,
      targetAudioTrackIndex: 0,
      pacingPreset: "documentary",
    });

    expect(result.placements.length).toBeGreaterThan(0);
    expect(result.plan.actions.length).toBeGreaterThan(0);
    expect(result.plan.actions.some((action) => action.kind === "cut_silence")).toBe(true);
    expect(result.plan.actions.some((action) => action.kind === "place_clip")).toBe(true);
    expect(result.plan.rationale.length).toBeGreaterThan(3);
    expect(result.diagnostics.ingestedSegments).toBe(3);
    expect(result.diagnostics.mediaScanned).toBe(3);
    expect(result.diagnostics.silenceSpansApplied).toBe(1);
  });

  it("still completes when no silence spans are supplied", async () => {
    const result = await runFullAutopilot({
      segments,
      mediaItems,
      targetVideoTrackIndex: 1,
      targetAudioTrackIndex: 0,
    });

    expect(result.diagnostics.silenceSpansApplied).toBe(0);
    expect(result.plan.actions.some((action) => action.kind === "cut_silence")).toBe(false);
    expect(result.plan.actions.some((action) => action.kind === "place_clip")).toBe(true);
  });

  it("falls back to deterministic council when no agent context is provided", async () => {
    const result = await runFullAutopilot({
      segments,
      mediaItems,
      targetVideoTrackIndex: 1,
      targetAudioTrackIndex: 0,
    });

    const agents = new Set(result.plan.rationale.map((entry) => entry.agent));
    expect(agents.has("director")).toBe(true);
    expect(agents.has("critic")).toBe(true);
  });
});
