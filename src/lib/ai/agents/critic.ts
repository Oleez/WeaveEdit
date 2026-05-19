import { EditPlan } from "@/lib/edit-core/types";
import { AgentContext, agentResult, buildDeliberation, callOllamaAgent, visualActions } from "./shared";

export async function critiquePlan(plan: EditPlan, agentContext?: AgentContext) {
  const visual = visualActions(plan);
  const blanks = visual.filter((action) => action.kind === "place_clip" && !action.mediaPath);

  const fallback = {
    agent: "critic" as const,
    claim: blanks.length
      ? "Preview is usable, but blank/fallback beats should be reviewed before applying."
      : "Preview has enough media coverage to be safe for an apply pass.",
    evidence: [`${visual.length} visual actions`, `${blanks.length} blank or face-time actions`],
    confidence: blanks.length ? 0.64 : 0.86,
  };

  const response = await callOllamaAgent(agentContext, {
    role: "critic",
    instructions:
      "Decide whether this plan is safe to apply. Flag risks like over-blank beats, missing audio polish, or weak coverage. Return claim/evidence/confidence only.",
    inputJson: {
      totalActions: plan.actions.length,
      kinds: plan.actions.map((action) => action.kind),
      visualCount: visual.length,
      blankCount: blanks.length,
    },
    responseShape: '{"claim": string, "evidence": string[], "confidence": number}',
  });

  return agentResult([buildDeliberation("critic", fallback, response)]);
}
