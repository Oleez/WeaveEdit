import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatAgentProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  deliberation: Array<{ agent: string; claim: string; confidence: number }>;
  diffSummary: string;
}

export function ChatAgent({ value, onChange, onSend, deliberation, diffSummary }: ChatAgentProps) {
  return (
    <aside className="flex min-h-0 flex-col border-l border-border/70 bg-card/90 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Timeline Chat</p>
      <h2 className="mt-2 text-lg font-semibold">Ask for an edit, preview first</h2>
      <div className="mt-4 flex-1 space-y-3 overflow-auto">
        {diffSummary ? (
          <div className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm">{diffSummary}</div>
        ) : null}
        {deliberation.map((item, index) => (
          <details key={`${item.agent}-${index}`} className="rounded-md border border-border/70 bg-background/70 p-3">
            <summary className="cursor-pointer text-sm font-medium capitalize">
              {item.agent} · {Math.round(item.confidence * 100)}%
            </summary>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.claim}</p>
          </details>
        ))}
      </div>
      <div className="mt-4 grid gap-2">
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Make the intro faster, add punch-ins on claims, polish audio..."
          className="min-h-[96px]"
        />
        <Button type="button" onClick={onSend} className="gap-2">
          <Send className="h-4 w-4" />
          Preview edit
        </Button>
      </div>
    </aside>
  );
}
