import { useMemo, useState } from "react";
import { TimelinePlacement } from "@/lib/timeline-plan";

export function useTimelineSelection(placements: TimelinePlacement[]) {
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const selectedPlacement = useMemo(
    () => placements.find((placement) => placement.id === selectedPlacementId) ?? null,
    [placements, selectedPlacementId],
  );

  return {
    selectedPlacementId,
    selectedPlacement,
    selectPlacement: setSelectedPlacementId,
    clearSelection: () => setSelectedPlacementId(null),
  };
}
