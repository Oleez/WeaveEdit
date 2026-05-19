import { ChatEditIntent, EditPlan } from "@/lib/edit-core/types";
import { replanFromIntent } from "@/lib/edit-core/autopilot";

export function parseChatIntent(rawText: string): ChatEditIntent {
  const text = rawText.toLowerCase();
  const ops: ChatEditIntent["ops"] = [];

  if (/(tight|silence|faster|snappier|200ms|0\.2)/.test(text)) {
    ops.push({ kind: "tighten", value: text.includes("200") || text.includes("0.2") ? 0.2 : 0.35 });
  }
  if (/(punch|zoom|push in|claim|emphasis)/.test(text)) {
    ops.push({ kind: "punch_in", value: 112 });
  }
  if (/(caption|subtitle|words)/.test(text)) {
    ops.push({ kind: "captions" });
  }
  if (/(audio|lufs|duck|music|loud)/.test(text)) {
    ops.push({ kind: "audio_polish" });
  }
  if (/(transition|dissolve|smooth)/.test(text)) {
    ops.push({ kind: "transitions" });
  }
  if (/(color|grade|match)/.test(text)) {
    ops.push({ kind: "color_match" });
  }

  return {
    rawText,
    ops: ops.length > 0 ? ops : [{ kind: "replace_broll", target: "low_confidence" }],
  };
}

export async function routeChatToPlan(plan: EditPlan, rawText: string): Promise<EditPlan> {
  return replanFromIntent(plan, parseChatIntent(rawText));
}
