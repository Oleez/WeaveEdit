import { useState } from "react";
import {
  AutopilotInput,
  FullAutopilotInput,
  FullAutopilotResult,
  runAutopilot,
  runFullAutopilot,
} from "@/lib/edit-core/autopilot";
import { EditPlan } from "@/lib/edit-core/types";

export function useAutopilot() {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<FullAutopilotResult["diagnostics"] | null>(null);

  async function buildAutopilotPlan(input: AutopilotInput): Promise<EditPlan> {
    setBusy(true);
    setStage("Council deliberating");
    try {
      return await runAutopilot(input);
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  async function buildFullPipelinePlan(input: FullAutopilotInput): Promise<FullAutopilotResult> {
    setBusy(true);
    setStage("Running full autopilot pipeline");
    try {
      const result = await runFullAutopilot(input);
      setDiagnostics(result.diagnostics);
      return result;
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  return { busy, stage, diagnostics, buildAutopilotPlan, buildFullPipelinePlan };
}
