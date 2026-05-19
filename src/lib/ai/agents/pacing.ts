import { EditPlan } from "@/lib/edit-core/types";
import { agentResult, visualActions } from "./shared";

export async function reviewPacing(plan: EditPlan) {
  const clips = visualActions(plan);
  const longClips = clips.filter((action) => action.kind === "place_clip" && action.endSec - action.startSec > 8);

  return agentResult(
    [
      {
        agent: "pacing",
        claim: longClips.length
          ? "A few visual beats are long enough to deserve punch-in or B-roll refresh attention."
          : "Shot rhythm is inside the configured readable range.",
        evidence: [`${clips.length} visual beats`, `${longClips.length} long beats`],
        confidence: 0.74,
      },
    ],
    longClips.slice(0, 4).map((action) => ({
      kind: "punch_in",
      placementId: action.kind === "place_clip" ? action.placementId : "",
      scalePct: 108,
      durationSec: 0.75,
    })),
  );
}
