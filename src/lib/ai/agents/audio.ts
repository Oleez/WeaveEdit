import { EditPlan } from "@/lib/edit-core/types";
import { AgentContext, agentResult, buildDeliberation, callOllamaAgent } from "./shared";

export async function analyzeAudio(
  _plan: EditPlan,
  options: { targetAudioTrackIndex: number; targetLufs: number },
  agentContext?: AgentContext,
) {
  const fallback = {
    agent: "audio" as const,
    claim: "Prepared social-delivery loudness normalization and music ducking as preview actions.",
    evidence: [`target A${options.targetAudioTrackIndex + 1}`, `${options.targetLufs} LUFS target`],
    confidence: 0.7,
  };

  const response = await callOllamaAgent(agentContext, {
    role: "audio",
    instructions:
      "Confirm whether loudness normalization to the target LUFS and side-chain ducking under the voice track is appropriate. Reject only if creator profile or custom direction calls for raw audio.",
    inputJson: {
      voiceTrack: options.targetAudioTrackIndex + 1,
      musicTrack: options.targetAudioTrackIndex + 2,
      targetLufs: options.targetLufs,
    },
    responseShape: '{"claim": string, "evidence": string[], "confidence": number}',
  });

  return agentResult(
    [buildDeliberation("audio", fallback, response)],
    [
      { kind: "normalize_loudness", trackIndex: options.targetAudioTrackIndex, targetLufs: options.targetLufs },
      {
        kind: "duck_under_voice",
        voiceTrackIndex: options.targetAudioTrackIndex,
        musicTrackIndex: options.targetAudioTrackIndex + 1,
        duckDb: -9,
      },
    ],
  );
}
