import { ReactNode } from "react";
import { Image as ImageIcon, PenLine, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatSeconds } from "@/lib/script-parser";
import { ChatAgentView } from "./chat-types";

export function ChatAgent({
  messages,
  input,
  onInputChange,
  onSend,
  busy,
  playheadSec,
  deliberation,
  onQuickAction,
}: ChatAgentView) {
  return (
    <aside className="flex min-h-0 flex-1 flex-col p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Studio Chat</p>
          <h2 className="mt-1 text-lg font-semibold">Edit the script &amp; timeline with gemma</h2>
          <p className="mt-1 text-xs leading-4 text-muted-foreground">
            Type what you want changed, in plain words — the edit updates in the preview first.
          </p>
        </div>
        <span className="rounded-full border border-border/70 bg-background/70 px-2 py-1 font-mono text-[11px] text-muted-foreground">
          ▮ {formatSeconds(playheadSec)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <QuickChip icon={<PenLine className="h-3.5 w-3.5" />} label="Edit line here" onClick={() => onQuickAction("edit_line")} disabled={busy} />
        <QuickChip icon={<ImageIcon className="h-3.5 w-3.5" />} label="Make image here" onClick={() => onQuickAction("make_image")} disabled={busy} />
        <QuickChip icon={<Sparkles className="h-3.5 w-3.5" />} label="B-roll for section" onClick={() => onQuickAction("broll_section")} disabled={busy} />
      </div>

      <div className="mt-4 flex-1 space-y-3 overflow-auto">
        {messages.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/70 p-3 text-xs leading-5 text-muted-foreground">
            Move the playhead to a line, then ask for an edit — e.g. &ldquo;tighten this line&rdquo;,
            &ldquo;make it punchier&rdquo;, or &ldquo;make an image for this moment&rdquo;.
          </p>
        ) : null}

        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === "user"
                ? "rounded-md border border-primary/40 bg-primary/10 p-3 text-sm"
                : "rounded-md border border-border/70 bg-background/70 p-3 text-sm"
            }
          >
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {message.role === "user" ? "You" : "Gemma"}
            </p>
            <p className="mt-1 whitespace-pre-wrap leading-5">{message.content}</p>
            {message.activity?.length ? (
              <ul className="mt-2 space-y-1 border-t border-border/50 pt-2">
                {message.activity.map((line, index) => (
                  <li key={index} className="text-xs leading-5 text-muted-foreground">
                    ↳ {line}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}

        {busy ? <p className="text-xs text-muted-foreground">Gemma is working…</p> : null}

        {deliberation.map((item, index) => (
          <details key={`${item.agent}-${index}`} className="rounded-md border border-border/70 bg-background/60 p-3">
            <summary className="cursor-pointer text-sm font-medium capitalize">
              {item.agent} · {Math.round(item.confidence * 100)}%
            </summary>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.claim}</p>
          </details>
        ))}
      </div>

      <div className="mt-4 grid gap-2">
        <Textarea
          id="studio-chat-input"
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (!busy) {
                onSend();
              }
            }
          }}
          placeholder="Tighten this line, add punch-ins on claims, make an image for this moment…"
          className="min-h-[88px]"
          disabled={busy}
        />
        <Button type="button" onClick={onSend} className="gap-2" disabled={busy || !input.trim()}>
          <Send className="h-4 w-4" />
          {busy ? "Working…" : "Send"}
        </Button>
      </div>
    </aside>
  );
}

function QuickChip({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:bg-accent disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  );
}
