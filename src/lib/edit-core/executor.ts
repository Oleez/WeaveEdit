import {
  ExecuteTimelineJobInput,
  SilenceCleanupJobInput,
  executeAudioPolish,
  executeCaptions,
  executeColorMatch,
  executeExport,
  executeSilenceCleanup,
  executeTimelineJob,
  executeTransitions,
} from "@/lib/cep";
import { EditAction, EditPlan } from "./types";

export interface EditExecutorOptions {
  targetVideoTrackIndex: number;
  appendAtTrackEnd: boolean;
  useSequenceInOut: boolean;
  rangeStartSec: number | null;
  rangeEndSec: number | null;
  silenceSettings?: Omit<SilenceCleanupJobInput, "spans">;
}

export interface EditExecutorResult {
  ok: boolean;
  messages: string[];
}

export async function runEditPlan(plan: EditPlan, options: EditExecutorOptions): Promise<EditExecutorResult> {
  const messages: string[] = [];
  const placementPayload = buildTimelineJobPayload(plan.actions, options);
  if (placementPayload.placements.length > 0) {
    const result = await executeTimelineJob(placementPayload);
    messages.push(result.message);
  }

  const silenceActions = plan.actions.filter((action) => action.kind === "cut_silence");
  for (const action of silenceActions) {
    const result = await executeSilenceCleanup({
      targetAudioTrackIndex: options.silenceSettings?.targetAudioTrackIndex ?? action.audioTrackIndex,
      silenceThresholdDb: options.silenceSettings?.silenceThresholdDb ?? -38,
      minSilenceSec: options.silenceSettings?.minSilenceSec ?? 0.35,
      keepSilenceSec: options.silenceSettings?.keepSilenceSec ?? 0.08,
      spans: action.spans,
    });
    messages.push(result.message);
  }

  await runOptionalBridge("audio polish", messages, () =>
    executeAudioPolish(plan.actions.filter((action) =>
      action.kind === "normalize_loudness" || action.kind === "duck_under_voice" || action.kind === "set_audio_level",
    )),
  );
  await runOptionalBridge("captions", messages, () =>
    executeCaptions(plan.actions.filter((action) => action.kind === "add_caption_run")),
  );
  await runOptionalBridge("color match", messages, () =>
    executeColorMatch(plan.actions.filter((action) => action.kind === "color_match")),
  );
  await runOptionalBridge("transitions", messages, () =>
    executeTransitions(plan.actions.filter((action) => action.kind === "add_transition")),
  );

  const exportAction = plan.actions.find((action) => action.kind === "export");
  if (exportAction?.kind === "export") {
    await runOptionalBridge("export", messages, () => executeExport(exportAction));
  }

  return { ok: true, messages };
}

export function buildTimelineJobPayload(
  actions: EditAction[],
  options: EditExecutorOptions,
): ExecuteTimelineJobInput {
  const placements = actions
    .filter((action) => action.kind === "place_clip")
    .map((action) => ({
      id: action.placementId,
      groupId: action.placement?.groupId,
      layerIndex: action.placement?.layerIndex,
      trackOffset: action.placement?.trackOffset,
      startSec: action.startSec,
      endSec: action.endSec,
      durationSec: Math.max(0.01, action.endSec - action.startSec),
      sourceInSec: action.placement?.sourceInSec,
      sourceOutSec: action.placement?.sourceOutSec,
      mediaPath: action.mediaPath,
      strategy: action.placement?.strategy ?? "blank",
      text: action.placement?.text ?? "",
    }));

  return {
    targetVideoTrackIndex: options.targetVideoTrackIndex,
    appendAtTrackEnd: options.appendAtTrackEnd,
    useSequenceInOut: options.useSequenceInOut,
    rangeStartSec: options.rangeStartSec,
    rangeEndSec: options.rangeEndSec,
    placements,
  };
}

async function runOptionalBridge(
  label: string,
  messages: string[],
  runner: () => Promise<{ ok: boolean; message: string }>,
) {
  const result = await runner();
  if (result.message) {
    messages.push(`${label}: ${result.message}`);
  }
}
