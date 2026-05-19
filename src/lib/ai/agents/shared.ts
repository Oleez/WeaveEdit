import { EditAction, EditPlan, AgentDeliberation } from "@/lib/edit-core/types";

export interface AgentResult {
  actions: EditAction[];
  rationale: AgentDeliberation[];
}

export function agentResult(rationale: AgentDeliberation[], actions: EditAction[] = []): AgentResult {
  return { actions, rationale };
}

export function visualActions(plan: EditPlan) {
  return plan.actions.filter((action) => action.kind === "place_clip");
}
