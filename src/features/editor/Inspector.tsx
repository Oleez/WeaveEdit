import { TimelinePlacement } from "@/lib/timeline-plan";
import { formatSeconds } from "@/lib/script-parser";
import { ChatAgent } from "./ChatAgent";
import { ChatAgentView } from "./chat-types";

interface InspectorProps {
  placement: TimelinePlacement | null;
  chat: ChatAgentView;
  liked?: boolean;
  disliked?: boolean;
  onPreference?: (preference: "liked" | "disliked") => void;
}

export function Inspector({ placement, chat, liked, disliked, onPreference }: InspectorProps) {
  if (!placement) {
    return <ChatAgent {...chat} />;
  }

  return (
    <aside className="flex min-h-0 flex-1 flex-col p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Inspector</p>
      <h2 className="mt-2 text-lg font-semibold">{placement.mediaName || "Face-time / blank beat"}</h2>
      <p className="mt-1 text-xs leading-4 text-muted-foreground">
        Details for the selected clip. Like/Dislike teaches the editor your taste.
      </p>
      <dl className="mt-4 grid gap-3 text-sm">
        <Info label="Timing" value={`${formatSeconds(placement.startSec)} - ${formatSeconds(placement.endSec)}`} />
        <Info label="Role" value={placement.editorialRole} />
        <Info label="Strategy" value={placement.strategy} />
        <Info label="Confidence" value={`${Math.round(placement.aiConfidence * 100)}%`} />
      </dl>
      <p className="mt-5 text-sm leading-6 text-muted-foreground">{placement.text}</p>
      {placement.aiRationale ? (
        <p className="mt-4 rounded-md border border-border/70 bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
          {placement.aiRationale}
        </p>
      ) : null}
      {onPreference ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onPreference("liked")}
            className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
              liked ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-200" : "border-border/70 hover:bg-accent"
            }`}
          >
            Like
          </button>
          <button
            type="button"
            onClick={() => onPreference("disliked")}
            className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
              disliked ? "border-rose-500/70 bg-rose-500/15 text-rose-200" : "border-border/70 hover:bg-accent"
            }`}
          >
            Dislike
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 pb-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
