import { EditPlan } from "@/lib/edit-core/types";
import { AgentContext, agentResult, buildDeliberation, callOllamaAgent, visualActions } from "./shared";

export async function reviewContinuity(plan: EditPlan, agentContext?: AgentContext) {
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

  const fallback = {
    agent: "continuity" as const,
    claim: repeated > 2
      ? "Some assets repeat often; review repeated chips before committing."
      : "Asset reuse looks controlled for a first pass.",
    evidence: [`${seen.size} unique media items`, `${repeated} repeated placements`],
    confidence: 0.72,
  };

  const response = await callOllamaAgent(agentContext, {
    role: "continuity",
    instructions:
      "Decide if the level of asset reuse is editorially safe. Be explicit if the same clip is over-used. Return claim/evidence/confidence only.",
    inputJson: { uniqueAssets: seen.size, repeated, totalClips: clips.length },
    responseShape: '{"claim": string, "evidence": string[], "confidence": number}',
  });

  return agentResult([buildDeliberation("continuity", fallback, response)]);
}
