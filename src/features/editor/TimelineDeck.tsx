import { TimelinePlacement } from "@/lib/timeline-plan";
import { formatSeconds } from "@/lib/script-parser";
import { EditPlanDiff } from "@/lib/edit-core/types";

interface TimelineDeckProps {
  placements: TimelinePlacement[];
  selectedPlacementId: string | null;
  onSelectPlacement: (placementId: string) => void;
  diff: EditPlanDiff;
}

const TRACKS = ["V2", "V1", "A1", "A2", "Captions"];

export function TimelineDeck({ placements, selectedPlacementId, onSelectPlacement, diff }: TimelineDeckProps) {
  const duration = Math.max(1, ...placements.map((placement) => placement.endSec));
  const addedIds = new Set(
    diff.added
      .filter(
        (action) =>
          action.kind === "place_clip" ||
          action.kind === "punch_in" ||
          action.kind === "add_transition" ||
          action.kind === "color_match" ||
          action.kind === "trim_clip",
      )
      .map((action) => ("placementId" in action ? action.placementId : "")),
  );
  const changedIds = new Set(
    diff.changed
      .map(({ after }) => after)
      .filter((action) => "placementId" in action)
      .map((action) => ("placementId" in action ? action.placementId : "")),
  );
  const resolveChipClass = (placement: TimelinePlacement) => {
    if (selectedPlacementId === placement.id) {
      return "bg-primary text-primary-foreground";
    }
    if (addedIds.has(placement.id)) {
      return "bg-emerald-500/40 text-emerald-50 ring-1 ring-emerald-300/60";
    }
    if (changedIds.has(placement.id)) {
      return "bg-violet-500/35 text-violet-50 ring-1 ring-violet-300/60";
    }
    if (placement.lowConfidence) {
      return "bg-amber-500/30 text-amber-100";
    }
    return "bg-sky-500/25 text-sky-100 hover:bg-sky-500/40";
  };

  return (
    <section className="border-t border-border/70 bg-card/80 p-3">
      <p className="mb-2 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground/80">Timeline</span> — every planned clip; click a chip to inspect.
        Green = newly added, purple = changed by your last edit, amber = low confidence.
      </p>
      <div className="grid gap-2">
        {TRACKS.map((track) => (
          <div key={track} className="grid grid-cols-[72px_1fr] items-center gap-2">
            <div className="text-xs font-medium text-muted-foreground">{track}</div>
            <div className="relative h-10 overflow-hidden rounded-md border border-border/70 bg-background/70">
              {track === "V1"
                ? placements.map((placement) => (
                    <button
                      key={placement.id}
                      type="button"
                      onClick={() => onSelectPlacement(placement.id)}
                      className={`absolute top-1 h-8 overflow-hidden rounded px-2 text-left text-[11px] leading-8 transition ${resolveChipClass(placement)}`}
                      style={{
                        left: `${(placement.startSec / duration) * 100}%`,
                        width: `${Math.max(3, ((placement.endSec - placement.startSec) / duration) * 100)}%`,
                      }}
                      title={`${formatSeconds(placement.startSec)} ${placement.mediaName ?? "blank"}`}
                    >
                      {placement.mediaName || "face-time"}
                    </button>
                  ))
                : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
