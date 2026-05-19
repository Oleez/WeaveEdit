import { useState } from "react";
import { runAutopilot, AutopilotInput } from "@/lib/edit-core/autopilot";
import { EditPlan } from "@/lib/edit-core/types";

export function useAutopilot() {
  const [busy, setBusy] = useState(false);

  async function buildAutopilotPlan(input: AutopilotInput): Promise<EditPlan> {
    setBusy(true);
    try {
      return await runAutopilot(input);
    } finally {
      setBusy(false);
    }
  }

  return { busy, buildAutopilotPlan };
}
