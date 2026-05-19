import { EditPlan } from "@/lib/edit-core/types";
import { agentResult, visualActions } from "./shared";

export async function critiquePlan(plan: EditPlan) {
  const visual = visualActions(plan);
  const blanks = visual.filter((action) => action.kind === "place_clip" && !action.mediaPath);

  return agentResult([
    {
      agent: "critic",
      claim: blanks.length
        ? "Preview is usable, but blank/fallback beats should be reviewed before applying."
        : "Preview has enough media coverage to be safe for an apply pass.",
      evidence: [`${visual.length} visual actions`, `${blanks.length} blank or face-time actions`],
      confidence: blanks.length ? 0.64 : 0.86,
    },
  ]);
}
