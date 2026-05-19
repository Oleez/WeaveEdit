import { EditAction, EditPlan, EditPlanDiff } from "./types";

export function diffEditPlans(before: EditPlan | null | undefined, after: EditPlan): EditPlanDiff {
  if (!before) {
    return { added: after.actions, changed: [], removed: [] };
  }

  const beforeByKey = new Map(before.actions.map((action) => [actionKey(action), action]));
  const afterByKey = new Map(after.actions.map((action) => [actionKey(action), action]));
  const added: EditAction[] = [];
  const changed: Array<{ before: EditAction; after: EditAction }> = [];
  const removed: EditAction[] = [];

  afterByKey.forEach((afterAction, key) => {
    const beforeAction = beforeByKey.get(key);
    if (!beforeAction) {
      added.push(afterAction);
      return;
    }

    if (stableActionJson(beforeAction) !== stableActionJson(afterAction)) {
      changed.push({ before: beforeAction, after: afterAction });
    }
  });

  beforeByKey.forEach((beforeAction, key) => {
    if (!afterByKey.has(key)) {
      removed.push(beforeAction);
    }
  });

  return { added, changed, removed };
}

export function actionKey(action: EditAction): string {
  switch (action.kind) {
    case "place_clip":
    case "trim_clip":
    case "add_transition":
    case "speed_ramp":
    case "punch_in":
    case "color_match":
      return `${action.kind}:${action.placementId}`;
    case "cut_silence":
      return `${action.kind}:A${action.audioTrackIndex}`;
    case "set_audio_level":
    case "normalize_loudness":
      return `${action.kind}:A${action.trackIndex}`;
    case "duck_under_voice":
      return `${action.kind}:M${action.musicTrackIndex}:V${action.voiceTrackIndex}`;
    case "add_caption_run":
      return `${action.kind}:${action.track}`;
    case "reorder_segments":
      return `${action.kind}:sequence`;
    case "export":
      return `${action.kind}:${action.preset}`;
  }
}

function stableActionJson(action: EditAction): string {
  return JSON.stringify(action, (_key, value) => {
    if (_key === "placement") {
      return undefined;
    }
    return value;
  });
}
