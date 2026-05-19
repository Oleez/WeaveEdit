import { TimelinePlacement } from "@/lib/timeline-plan";
import { formatSeconds } from "@/lib/script-parser";

interface TimelineDeckProps {
  placements: TimelinePlacement[];
  selectedPlacementId: string | null;
  onSelectPlacement: (placementId: string) => void;
}

const TRACKS = ["V2", "V1", "A1", "A2", "Captions"];

export function TimelineDeck({ placements, selectedPlacementId, onSelectPlacement }: TimelineDeckProps) {
  const duration = Math.max(1, ...placements.map((placement) => placement.endSec));

  return (
    <section className="border-t border-border/70 bg-card/80 p-3">
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
                      className={`absolute top-1 h-8 overflow-hidden rounded px-2 text-left text-[11px] leading-8 transition ${
                        selectedPlacementId === placement.id
                          ? "bg-primary text-primary-foreground"
                          : placement.lowConfidence
                            ? "bg-amber-500/30 text-amber-100"
                            : "bg-sky-500/25 text-sky-100 hover:bg-sky-500/40"
                      }`}
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
