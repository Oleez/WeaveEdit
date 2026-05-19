import { EditPlan } from "@/lib/edit-core/types";
import { agentResult } from "./shared";

export async function analyzeAudio(
  _plan: EditPlan,
  options: { targetAudioTrackIndex: number; targetLufs: number },
) {
  return agentResult(
    [
      {
        agent: "audio",
        claim: "Prepared social-delivery loudness normalization and music ducking as preview actions.",
        evidence: [`target A${options.targetAudioTrackIndex + 1}`, `${options.targetLufs} LUFS target`],
        confidence: 0.7,
      },
    ],
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
