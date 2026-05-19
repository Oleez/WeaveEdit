import { describe, expect, it } from "vitest";
import { directEdit } from "../../src/lib/ai/agents/director";
import { reviewPacing } from "../../src/lib/ai/agents/pacing";
import { reviewContinuity } from "../../src/lib/ai/agents/continuity";
import { analyzeAudio } from "../../src/lib/ai/agents/audio";
import { critiquePlan } from "../../src/lib/ai/agents/critic";
import { EditPlan } from "../../src/lib/edit-core/types";

function makePlan(actionCount: number): EditPlan {
  return {
    id: "plan-test",
    createdAt: new Date().toISOString(),
    actions: Array.from({ length: actionCount }, (_, index) => ({
      kind: "place_clip" as const,
      placementId: `p${index}`,
      track: "V1",
      startSec: index * 4,
      endSec: index * 4 + 4,
      mediaPath: index % 3 === 0 ? null : `C:/media/clip-${index}.mp4`,
    })),
    rationale: [],
  };
}

describe("agent fallbacks (no Ollama context)", () => {
  it("director returns a deterministic deliberation when agent context is missing", async () => {
    const plan = makePlan(3);
    const result = await directEdit(plan, { placements: [1, 2, 3] });
    expect(result.rationale).toHaveLength(1);
    expect(result.rationale[0].agent).toBe("director");
    expect(result.rationale[0].confidence).toBeGreaterThan(0);
  });

  it("pacing emits punch-ins for long beats and falls back without ollama", async () => {
    const plan: EditPlan = {
      id: "plan-long",
      createdAt: new Date().toISOString(),
      actions: [
        { kind: "place_clip", placementId: "p0", track: "V1", startSec: 0, endSec: 12, mediaPath: "x.mp4" },
        { kind: "place_clip", placementId: "p1", track: "V1", startSec: 12, endSec: 24, mediaPath: "y.mp4" },
      ],
      rationale: [],
    };
    const result = await reviewPacing(plan);
    expect(result.actions.filter((action) => action.kind === "punch_in")).toHaveLength(2);
  });

  it("continuity flags repeated assets", async () => {
    const plan: EditPlan = {
      id: "plan-repeat",
      createdAt: new Date().toISOString(),
      actions: [
        { kind: "place_clip", placementId: "p0", track: "V1", startSec: 0, endSec: 3, mediaPath: "same.mp4" },
        { kind: "place_clip", placementId: "p1", track: "V1", startSec: 3, endSec: 6, mediaPath: "same.mp4" },
        { kind: "place_clip", placementId: "p2", track: "V1", startSec: 6, endSec: 9, mediaPath: "same.mp4" },
        { kind: "place_clip", placementId: "p3", track: "V1", startSec: 9, endSec: 12, mediaPath: "same.mp4" },
      ],
      rationale: [],
    };
    const result = await reviewContinuity(plan);
    expect(result.rationale[0].claim).toMatch(/repeat/i);
  });

  it("audio always emits normalize_loudness + duck_under_voice", async () => {
    const plan = makePlan(2);
    const result = await analyzeAudio(plan, { targetAudioTrackIndex: 0, targetLufs: -14 });
    expect(result.actions.map((action) => action.kind)).toEqual(["normalize_loudness", "duck_under_voice"]);
  });

  it("critic reports lower confidence when blanks are present", async () => {
    const plan = makePlan(6);
    const result = await critiquePlan(plan);
    expect(result.rationale[0].confidence).toBeLessThan(0.9);
  });
});
