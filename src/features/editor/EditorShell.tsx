import { ReactNode, useEffect, useState } from "react";
import { PremiereStatus } from "@/lib/cep";
import { TimelinePlacement } from "@/lib/timeline-plan";
import { EditPlanDiff } from "@/lib/edit-core/types";
import { EditHistoryEntry } from "@/lib/edit-core/edit-history";
import { AutopilotBar } from "./AutopilotBar";
import { GuidedFlow } from "./GuidedFlow";
import { HistoryPanel } from "./HistoryPanel";
import { Inspector } from "./Inspector";
import { ChatAgentView } from "./chat-types";
import { DrawerTab, SettingsDrawer } from "./SettingsDrawer";
import { StageCanvas } from "./StageCanvas";
import { TimelineDeck } from "./TimelineDeck";

const PLAYBACK_TICK_MS = 200;

interface EditorShellProps {
  placements: TimelinePlacement[];
  selectedPlacementId: string | null;
  onSelectPlacement: (placementId: string) => void;
  hostStatus: PremiereStatus | null;
  providerLabel: string;
  rangeLabel: string;
  busy?: boolean;
  busyStage?: string | null;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onAutopilot: () => void;
  onApply: () => void;
  canApply: boolean;
  onUndo: () => void;
  canUndo: boolean;
  autoApply: boolean;
  onAutoApplyChange: (value: boolean) => void;
  hasTranscript: boolean;
  hasPreviewPlan: boolean;
  hasApplied: boolean;
  historyEntries: EditHistoryEntry[];
  onRestoreHistoryTo: (id: string) => void;
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
  busyStage,
  settingsOpen,
  onOpenSettings,
  onCloseSettings,
  onAutopilot,
  onApply,
  canApply,
  onUndo,
  canUndo,
  autoApply,
  onAutoApplyChange,
  hasTranscript,
  hasPreviewPlan,
  hasApplied,
  historyEntries,
  onRestoreHistoryTo,
  chat,
  diff,
  likedPlacementIds,
  dislikedPlacementIds,
  onPlacementPreference,
  settings,
  settingsTabs,
}: EditorShellProps) {
  const durationSec = Math.max(0, ...placements.map((placement) => placement.endSec));
  const [playheadSec, setPlayheadSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rightTab, setRightTab] = useState<"chat" | "history">("chat");

  useEffect(() => {
    if (!playing) {
      return;
    }
    const handle = window.setInterval(() => {
      setPlayheadSec((current) => {
        const next = current + PLAYBACK_TICK_MS / 1000;
        if (next >= durationSec) {
          setPlaying(false);
          return durationSec;
        }
        return next;
      });
    }, PLAYBACK_TICK_MS);
    return () => window.clearInterval(handle);
  }, [playing, durationSec]);

  const selectedPlacement = placements.find((placement) => placement.id === selectedPlacementId) ?? null;
  const placementAtPlayhead =
    placements.find((placement) => playheadSec >= placement.startSec && playheadSec < placement.endSec) ?? null;
  const stagePlacement = (playing ? placementAtPlayhead : selectedPlacement ?? placementAtPlayhead) ?? placements[0] ?? null;

  function selectAndSeek(placementId: string) {
    const placement = placements.find((item) => item.id === placementId);
    if (placement) {
      setPlayheadSec(placement.startSec);
    }
    onSelectPlacement(placementId);
  }

  function skipToBoundary(direction: -1 | 1) {
    const boundaries = [...new Set(placements.map((placement) => placement.startSec))].sort((a, b) => a - b);
    if (boundaries.length === 0) {
      return;
    }
    const epsilon = 0.01;
    const target =
      direction === 1
        ? boundaries.find((sec) => sec > playheadSec + epsilon) ?? boundaries[boundaries.length - 1]
        : [...boundaries].reverse().find((sec) => sec < playheadSec - epsilon) ?? boundaries[0];
    setPlayheadSec(target);
    const placement = placements.find(
      (item) => Math.abs(item.startSec - target) < epsilon || (target >= item.startSec && target < item.endSec),
    );
    if (placement) {
      onSelectPlacement(placement.id);
    }
  }

  return (
    <main className="dark min-h-screen bg-background text-foreground">
      <AutopilotBar
        providerLabel={providerLabel}
        sequenceLabel={hostStatus?.sequenceName || "No active sequence"}
        rangeLabel={rangeLabel}
        busy={busy}
        busyStage={busyStage}
        onAutopilot={onAutopilot}
        onApply={onApply}
        onUndo={onUndo}
        canUndo={canUndo}
        onOpenSettings={onOpenSettings}
        canApply={canApply}
        autoApply={autoApply}
        onAutoApplyChange={onAutoApplyChange}
      />
      <GuidedFlow
        hasTranscript={hasTranscript}
        hasPreviewPlan={hasPreviewPlan}
        hasApplied={hasApplied}
        busy={busy}
        onLoadTranscript={onOpenSettings}
        onAutopilot={onAutopilot}
        onApply={onApply}
      />
      <div className="grid min-h-[calc(100vh-64px)] grid-rows-[1fr_auto]">
        <div className="grid min-h-0 lg:grid-cols-[1fr_380px]">
          <StageCanvas
            placement={stagePlacement}
            playheadSec={playheadSec}
            durationSec={durationSec}
            playing={playing}
            onTogglePlay={() => setPlaying((value) => !value)}
            onSkipBack={() => skipToBoundary(-1)}
            onSkipForward={() => skipToBoundary(1)}
            onScrub={(sec) => setPlayheadSec(Math.min(durationSec, Math.max(0, sec)))}
          />
          <div className="flex min-h-0 flex-col border-l border-border/70 bg-card/90">
            <div className="flex gap-1 border-b border-border/70 px-4 pt-3">
              <RightTabButton active={rightTab === "chat"} onClick={() => setRightTab("chat")} label="Chat" />
              <RightTabButton
                active={rightTab === "history"}
                onClick={() => setRightTab("history")}
                label={`History${historyEntries.length > 0 ? ` (${historyEntries.length})` : ""}`}
              />
            </div>
            {rightTab === "history" ? (
              <div className="flex min-h-0 flex-1 flex-col p-4">
                <HistoryPanel entries={historyEntries} onRestoreTo={onRestoreHistoryTo} />
              </div>
            ) : (
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
            )}
          </div>
        </div>
        <TimelineDeck
          placements={placements}
          selectedPlacementId={selectedPlacementId}
          onSelectPlacement={selectAndSeek}
          diff={diff}
        />
      </div>
      <SettingsDrawer open={settingsOpen} onClose={onCloseSettings} tabs={settingsTabs}>
        {settings}
      </SettingsDrawer>
    </main>
  );
}

function RightTabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-t-md border border-b-0 px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "border-border/70 bg-background text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}
