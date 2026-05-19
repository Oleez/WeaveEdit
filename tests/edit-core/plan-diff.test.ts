import { describe, expect, it } from "vitest";
import { diffEditPlans } from "../../src/lib/edit-core/plan-diff";
import { EditPlan } from "../../src/lib/edit-core/types";

describe("diffEditPlans", () => {
  it("reports added and changed actions by stable action key", () => {
    const before: EditPlan = {
      id: "a",
      createdAt: "now",
      rationale: [],
      actions: [{ kind: "trim_clip", placementId: "p1", newStartSec: 0, newEndSec: 2 }],
    };
    const after: EditPlan = {
      id: "b",
      createdAt: "now",
      rationale: [],
      actions: [
        { kind: "trim_clip", placementId: "p1", newStartSec: 0, newEndSec: 3 },
        { kind: "normalize_loudness", trackIndex: 0, targetLufs: -14 },
      ],
    };

    const diff = diffEditPlans(before, after);
    expect(diff.changed).toHaveLength(1);
    expect(diff.added).toHaveLength(1);
    expect(diff.removed).toHaveLength(0);
  });
});
