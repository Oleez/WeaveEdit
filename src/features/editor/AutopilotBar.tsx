import { Bot, Download, Settings2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AutopilotBarProps {
  providerLabel: string;
  sequenceLabel: string;
  rangeLabel: string;
  busy?: boolean;
  onAutopilot: () => void;
  onApply: () => void;
  onOpenSettings: () => void;
  canApply: boolean;
}

export function AutopilotBar({
  providerLabel,
  sequenceLabel,
  rangeLabel,
  busy,
  onAutopilot,
  onApply,
  onOpenSettings,
  canApply,
}: AutopilotBarProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/70 bg-background/95 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bot className="h-4 w-4 text-primary" />
          Weave Edit
        </div>
        <StatusChip value={providerLabel} />
        <StatusChip value={sequenceLabel} />
        <StatusChip value={rangeLabel} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={onAutopilot} disabled={busy} className="gap-2">
          <Sparkles className="h-4 w-4" />
          {busy ? "Building edit" : "Autopilot full edit"}
        </Button>
        <Button type="button" variant="secondary" onClick={onApply} disabled={!canApply} className="gap-2">
          <Download className="h-4 w-4" />
          Apply
        </Button>
        <Button type="button" variant="outline" size="icon" onClick={onOpenSettings} aria-label="Open settings">
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function StatusChip({ value }: { value: string }) {
  return (
    <span className="max-w-[220px] truncate rounded-md border border-border/70 bg-card px-2.5 py-1 text-xs text-muted-foreground">
      {value}
    </span>
  );
}
