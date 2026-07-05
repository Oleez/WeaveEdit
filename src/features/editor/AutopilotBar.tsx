import { Bot, Download, Loader2, Settings2, Sparkles, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PANEL_VERSION } from "@/lib/version";

interface AutopilotBarProps {
  providerLabel: string;
  sequenceLabel: string;
  rangeLabel: string;
  busy?: boolean;
  busyStage?: string | null;
  onAutopilot: () => void;
  onApply: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onOpenSettings: () => void;
  canApply: boolean;
  autoApply: boolean;
  onAutoApplyChange: (value: boolean) => void;
}

export function AutopilotBar({
  providerLabel,
  sequenceLabel,
  rangeLabel,
  busy,
  busyStage,
  onAutopilot,
  onApply,
  onUndo,
  canUndo,
  onOpenSettings,
  canApply,
  autoApply,
  onAutoApplyChange,
}: AutopilotBarProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/70 bg-background/95 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bot className="h-4 w-4 text-primary" />
          Weave Edit
          <span
            className="rounded border border-border/60 px-1 py-0.5 font-mono text-[10px] font-normal text-muted-foreground"
            title="Panel build version — if this doesn't match the latest install, restart Premiere Pro"
          >
            v{PANEL_VERSION}
          </span>
        </div>
        <StatusChip value={providerLabel} title="The AI model doing the editing work" />
        <StatusChip value={sequenceLabel} title="Active Premiere timeline tab — updates automatically when you switch sequence tabs" />
        <StatusChip value={rangeLabel} title="The part of the timeline edits will be placed into" />
        {busy && busyStage ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary">
            <Loader2 className="h-3 w-3 animate-spin" />
            {busyStage}…
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label
          className="flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground"
          title="Skip review — the finished edit goes straight to your Premiere timeline"
        >
          <input
            type="checkbox"
            checked={autoApply}
            onChange={(event) => onAutoApplyChange(event.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          Auto-apply
        </label>
        <LabeledButton subtitle="Steps back one edit">
          <Button type="button" variant="outline" onClick={onUndo} disabled={!canUndo} className="gap-2">
            <Undo2 className="h-4 w-4" />
            Undo
          </Button>
        </LabeledButton>
        <LabeledButton subtitle="One click: silence cut → B-roll → captions → audio">
          <Button type="button" onClick={onAutopilot} disabled={busy} className="gap-2">
            <Sparkles className="h-4 w-4" />
            {busy ? "Weaving…" : "Weave full edit"}
          </Button>
        </LabeledButton>
        <LabeledButton subtitle="Sends the previewed plan to Premiere">
          <Button type="button" variant="secondary" onClick={onApply} disabled={!canApply} className="gap-2">
            <Download className="h-4 w-4" />
            Apply
          </Button>
        </LabeledButton>
        <LabeledButton subtitle="All settings & tools">
          <Button type="button" variant="outline" onClick={onOpenSettings} className="gap-2">
            <Settings2 className="h-4 w-4" />
            Advanced
          </Button>
        </LabeledButton>
      </div>
    </div>
  );
}

function LabeledButton({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      {children}
      <span className="max-w-[150px] truncate text-center text-[10px] leading-3 text-muted-foreground">{subtitle}</span>
    </div>
  );
}

function StatusChip({ value, title }: { value: string; title?: string }) {
  return (
    <span
      title={title}
      className="max-w-[220px] truncate rounded-md border border-border/70 bg-card px-2.5 py-1 text-xs text-muted-foreground"
    >
      {value}
    </span>
  );
}
