import { History, RotateCcw } from "lucide-react";
import { EditHistoryEntry } from "@/lib/edit-core/edit-history";

interface HistoryPanelProps {
  entries: EditHistoryEntry[];
  onRestoreTo: (id: string) => void;
}

export function HistoryPanel({ entries, onRestoreTo }: HistoryPanelProps) {
  const newestFirst = [...entries].reverse();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="text-xs leading-5 text-muted-foreground">
        Every edit is saved here. Restore to any point to undo everything after it.
      </p>
      <div className="mt-3 flex-1 space-y-2 overflow-auto">
        {newestFirst.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/70 p-3 text-xs leading-5 text-muted-foreground">
            No edits yet. Run Autopilot or ask the chat for a change — each step will show up here.
          </p>
        ) : (
          newestFirst.map((entry) => (
            <div key={entry.id} className="rounded-md border border-border/70 bg-background/70 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{entry.label}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRestoreTo(entry.id)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] font-medium transition hover:bg-accent"
                  title="Undo everything after this point"
                >
                  <RotateCcw className="h-3 w-3" />
                  Restore to here
                </button>
              </div>
              {entry.appliedToPremiere ? (
                <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] leading-4 text-amber-200">
                  Already applied — restoring here resets the panel plan; use Ctrl+Z inside Premiere to revert the
                  timeline itself.
                </p>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
