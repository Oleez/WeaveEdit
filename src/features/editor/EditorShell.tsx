import { ReactNode } from "react";
import { PremiereStatus } from "@/lib/cep";
import { TimelinePlacement } from "@/lib/timeline-plan";
import { EditPlanDiff } from "@/lib/edit-core/types";
import { AutopilotBar } from "./AutopilotBar";
import { Inspector } from "./Inspector";
import { ChatAgentView } from "./chat-types";
import { DrawerTab, SettingsDrawer } from "./SettingsDrawer";
import { StageCanvas } from "./StageCanvas";
import { TimelineDeck } from "./TimelineDeck";

interface EditorShellProps {
  placements: TimelinePlacement[];
  selectedPlacementId: string | null;
  onSelectPlacement: (placementId: string) => void;
  hostStatus: PremiereStatus | null;
  providerLabel: string;
  rangeLabel: string;
  busy?: boolean;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onAutopilot: () => void;
  onApply: () => void;
  canApply: boolean;
  chat: ChatAgentView;
  diff: EditPlanDiff;
  likedPlacementIds: string[];
  dislikedPlacementIds: string[];
  onPlacementPreference: (placement: TimelinePlacement, preference: "liked" | "disliked") => void;
  settings?: ReactNode;
  settingsTabs?: DrawerTab[];
}

export function EditorShell({
  placements,
  selectedPlacementId,
  onSelectPlacement,
  hostStatus,
  providerLabel,
  rangeLabel,
  busy,
  settingsOpen,
  onOpenSettings,
  onCloseSettings,
  onAutopilot,
  onApply,
  canApply,
  chat,
  diff,
  likedPlacementIds,
  dislikedPlacementIds,
  onPlacementPreference,
  settings,
  settingsTabs,
}: EditorShellProps) {
  const selectedPlacement = placements.find((placement) => placement.id === selectedPlacementId) ?? placements[0] ?? null;
  const durationSec = Math.max(0, ...placements.map((placement) => placement.endSec));

  return (
    <main className="dark min-h-screen bg-background text-foreground">
      <AutopilotBar
        providerLabel={providerLabel}
        sequenceLabel={hostStatus?.sequenceName || "No active sequence"}
        rangeLabel={rangeLabel}
        busy={busy}
        onAutopilot={onAutopilot}
        onApply={onApply}
        onOpenSettings={onOpenSettings}
        canApply={canApply}
      />
      <div className="grid min-h-[calc(100vh-64px)] grid-rows-[1fr_auto]">
        <div className="grid min-h-0 lg:grid-cols-[1fr_380px]">
          <StageCanvas
            placement={selectedPlacement}
            playheadSec={selectedPlacement?.startSec ?? 0}
            durationSec={durationSec}
          />
          <Inspector
            placement={selectedPlacementId ? selectedPlacement : null}
            chat={chat}
            liked={Boolean(selectedPlacement && likedPlacementIds.includes(selectedPlacement.id))}
            disliked={Boolean(selectedPlacement && dislikedPlacementIds.includes(selectedPlacement.id))}
            onPreference={
              selectedPlacement
                ? (preference) => onPlacementPreference(selectedPlacement, preference)
                : undefined
            }
          />
        </div>
        <TimelineDeck
          placements={placements}
          selectedPlacementId={selectedPlacementId}
          onSelectPlacement={onSelectPlacement}
          diff={diff}
        />
      </div>
      <SettingsDrawer open={settingsOpen} onClose={onCloseSettings} tabs={settingsTabs}>
        {settings}
      </SettingsDrawer>
    </main>
  );
}
