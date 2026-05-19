import { EditAction, EditPlan } from "@/lib/edit-core/types";
import { AgentContext, agentResult, buildDeliberation, callOllamaAgent, visualActions } from "./shared";

export async function reviewPacing(plan: EditPlan, agentContext?: AgentContext) {
  const clips = visualActions(plan);
  const longClips = clips.filter((action) => action.kind === "place_clip" && action.endSec - action.startSec > 8);

  const fallback = {
    agent: "pacing" as const,
    claim: longClips.length
      ? "A few visual beats are long enough to deserve punch-in or B-roll refresh attention."
      : "Shot rhythm is inside the configured readable range.",
    evidence: [`${clips.length} visual beats`, `${longClips.length} long beats`],
    confidence: 0.74,
  };

  const punchActions: EditAction[] = longClips.slice(0, 4).map((action) => ({
    kind: "punch_in" as const,
    placementId: action.kind === "place_clip" ? action.placementId : "",
    scalePct: 108,
    durationSec: 0.75,
  }));

  const response = await callOllamaAgent(agentContext, {
    role: "pacing",
    instructions:
      "Inspect clip durations and identify long beats (>8s). Suggest whether punch-in or B-roll refresh helps retention. Return claim/evidence/confidence; do not return new actions.",
    inputJson: {
      durations: clips
        .filter((action) => action.kind === "place_clip")
        .map((action) => action.kind === "place_clip" ? Math.round((action.endSec - action.startSec) * 10) / 10 : null),
      longCount: longClips.length,
      totalClips: clips.length,
    },
    responseShape: '{"claim": string, "evidence": string[], "confidence": number}',
  });

  return agentResult([buildDeliberation("pacing", fallback, response)], punchActions);
}
