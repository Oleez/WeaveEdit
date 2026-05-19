import { EditPlan } from "@/lib/edit-core/types";
import { agentResult } from "./shared";

export async function directEdit(plan: EditPlan, context: { placements: unknown[]; creatorProfileSummary?: string }) {
  return agentResult([
    {
      agent: "director",
      claim: "Autopilot assembled a full preview plan and asked specialists for bounded one-pass improvements.",
      evidence: [
        `${context.placements.length} placements`,
        `${plan.actions.length} starting actions`,
        `Creator profile: ${context.creatorProfileSummary ?? "not learned yet"}`,
      ],
      confidence: context.placements.length > 0 ? 0.84 : 0.42,
    },
  ]);
}
