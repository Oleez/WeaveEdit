import { EditPlan } from "@/lib/edit-core/types";
import { AgentContext, agentResult, buildDeliberation, callOllamaAgent } from "./shared";

export async function directEdit(
  plan: EditPlan,
  context: { placements: unknown[] },
  agentContext?: AgentContext,
) {
  const fallback = {
    agent: "director" as const,
    claim: "Weave assembled a full preview plan and asked specialists for bounded one-pass improvements.",
    evidence: [`${context.placements.length} placements`, `${plan.actions.length} starting actions`],
    confidence: context.placements.length > 0 ? 0.84 : 0.42,
  };

  const response = await callOllamaAgent(agentContext, {
    role: "director",
    instructions:
      "Review the edit plan summary. Return one claim about overall plan readiness, evidence bullets (counts, gaps), and a confidence 0-1.",
    inputJson: {
      placements: context.placements.length,
      actions: plan.actions.length,
      kinds: plan.actions.map((action) => action.kind),
    },
    responseShape: '{"claim": string, "evidence": string[], "confidence": number}',
  });

  return agentResult([buildDeliberation("director", fallback, response)]);
}
