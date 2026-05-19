import { EditPlan } from "@/lib/edit-core/types";
import { agentResult, visualActions } from "./shared";

export async function reviewContinuity(plan: EditPlan) {
  const clips = visualActions(plan);
  const seen = new Set<string>();
  let repeated = 0;
  clips.forEach((action) => {
    if (action.kind !== "place_clip" || !action.mediaPath) {
      return;
    }
    if (seen.has(action.mediaPath)) {
      repeated += 1;
    }
    seen.add(action.mediaPath);
  });

  return agentResult([
    {
      agent: "continuity",
      claim: repeated > 2
        ? "Some assets repeat often; review repeated chips before committing."
        : "Asset reuse looks controlled for a first pass.",
      evidence: [`${seen.size} unique media items`, `${repeated} repeated placements`],
      confidence: 0.72,
    },
  ]);
}
