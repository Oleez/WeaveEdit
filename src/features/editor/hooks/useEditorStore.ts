import { useMemo, useState } from "react";
import { TimelinePlacement } from "@/lib/timeline-plan";
import { buildEditPlan } from "@/lib/edit-core/plan-builder";
import { diffEditPlans } from "@/lib/edit-core/plan-diff";
import { EditPlan } from "@/lib/edit-core/types";

export function useEditorStore(placements: TimelinePlacement[], targetVideoTrackIndex: number, targetAudioTrackIndex: number) {
  const [previewPlan, setPreviewPlan] = useState<EditPlan | null>(null);
  const basePlan = useMemo(
    () => buildEditPlan({ placements, targetVideoTrackIndex, targetAudioTrackIndex }),
    [placements, targetAudioTrackIndex, targetVideoTrackIndex],
  );
  const activePlan = previewPlan ?? basePlan;
  const diff = useMemo(() => diffEditPlans(previewPlan?.diffFrom ?? basePlan, activePlan), [activePlan, basePlan, previewPlan]);

  return {
    basePlan,
    activePlan,
    previewPlan,
    setPreviewPlan,
    diff,
  };
}
