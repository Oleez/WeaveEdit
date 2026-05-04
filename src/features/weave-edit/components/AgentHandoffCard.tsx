import type { AgentResultImportSummary } from "@/lib/ai/types";
import { CardHeader, InlineMessage, StatusCard, StatusPill } from "./ui";

interface AgentHandoffCardProps {
  promptCount: number;
  highPriorityOnly: boolean;
  resultJson: string;
  importSummary: AgentResultImportSummary | null;
  onHighPriorityOnlyChange: (value: boolean) => void;
  onCopyHandoffJson: () => void | Promise<void>;
  onExportHandoffJson: () => void;
  onExportHandoffMarkdown: () => void;
  onCopyResultContract: () => void | Promise<void>;
  onResultJsonChange: (value: string) => void;
  onImportResultJson: () => void;
}

export function AgentHandoffCard({
  promptCount,
  highPriorityOnly,
  resultJson,
  importSummary,
  onHighPriorityOnlyChange,
  onCopyHandoffJson,
  onExportHandoffJson,
  onExportHandoffMarkdown,
  onCopyResultContract,
  onResultJsonChange,
  onImportResultJson,
}: AgentHandoffCardProps) {
  return (
    <div className="rounded-3xl border border-border/70 bg-background/60 p-4">
      <CardHeader
        eyebrow="Agent Handoff"
        title="Automation Contract"
        description="Export a local package for future agents or paste returned JSON to link generated files back into the Asset Inbox."
        action={<StatusPill tone={promptCount > 0 ? "info" : "success"} label={`${promptCount} prompts`} />}
      />
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <StatusCard label="Package" value="JSON / Markdown" />
        <StatusCard label="Result contract" value="One result per asset" />
        <StatusCard label="Automation" value="Manual handoff only" />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 rounded-full border border-border/70 px-4 py-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={highPriorityOnly}
            onChange={(event) => onHighPriorityOnlyChange(event.target.checked)}
            className="accent-primary"
          />
          High priority only
        </label>
        <button
          type="button"
          onClick={() => void onCopyHandoffJson()}
          disabled={promptCount === 0}
          className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition disabled:opacity-50"
        >
          Copy Agent Handoff JSON
        </button>
        <button
          type="button"
          onClick={onExportHandoffJson}
          disabled={promptCount === 0}
          className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
        >
          Export JSON
        </button>
        <button
          type="button"
          onClick={onExportHandoffMarkdown}
          disabled={promptCount === 0}
          className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
        >
          Export Brief MD
        </button>
        <button
          type="button"
          onClick={() => void onCopyResultContract()}
          className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
        >
          Copy Agent Result Contract
        </button>
      </div>
      {promptCount === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No missing-asset prompts are available yet. Build a preview first, then export the handoff package.
        </p>
      ) : null}
      <div className="mt-4 grid gap-3 rounded-2xl border border-border/70 bg-card/50 p-3 text-sm">
        <label className="grid gap-2">
          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Paste Agent Result JSON
          </span>
          <textarea
            value={resultJson}
            onChange={(event) => onResultJsonChange(event.target.value)}
            placeholder='{"packageVersion":"1.0","results":[{"promptId":"...","placementId":"...","filePath":"D:/GeneratedAssets/...","sourceTool":"Seedance","assetType":"video","status":"completed","durationSec":6.2,"error":null}]}'
            className="min-h-[120px] rounded-2xl border border-border/70 bg-background/60 px-3 py-3 font-mono text-xs outline-none transition focus:border-primary"
          />
        </label>
        <button
          type="button"
          onClick={onImportResultJson}
          disabled={!resultJson.trim()}
          className="w-fit rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
        >
          Import returned assets
        </button>
      </div>
      {importSummary ? (
        <InlineMessage
          tone={importSummary.errors.length ? "warning" : "success"}
          message={`Agent result import: ${importSummary.imported} imported, ${importSummary.skipped} skipped${
            importSummary.errors.length ? `. ${importSummary.errors.slice(0, 2).join(" | ")}` : "."
          }`}
        />
      ) : null}
      <InlineMessage
        tone="neutral"
        message="This does not call agents or generation tools. It only exports local instructions and imports returned file paths."
      />
    </div>
  );
}
