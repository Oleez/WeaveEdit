import type { WorkflowQaItem, WorkflowQaReport } from "@/lib/ai/workflow-qa";
import { CardHeader, InlineMessage, StatusCard, StatusPill } from "./ui";

interface WorkflowQaCardProps {
  checklist: WorkflowQaItem[];
  report: WorkflowQaReport;
  onLoadDemoDirectorControls: () => void;
  onGenerateDemoAgentResultJson: () => void;
  onExportReportMarkdown: () => void;
  onExportReportJson: () => void;
}

export function WorkflowQaCard({
  checklist,
  report,
  onLoadDemoDirectorControls,
  onGenerateDemoAgentResultJson,
  onExportReportMarkdown,
  onExportReportJson,
}: WorkflowQaCardProps) {
  const readyCount = checklist.filter((item) => item.status === "ready").length;
  const warningCount = checklist.filter((item) => item.status === "warning").length;
  const missingCount = checklist.filter((item) => item.status === "missing").length;

  return (
    <div className="rounded-3xl border border-border/70 bg-background/60 p-4">
      <CardHeader
        eyebrow="Workflow QA"
        title="Pipeline Check"
        description="Verify the edit path from transcript and media through handoff, returned assets, analysis, rerank, preview, and Premiere readiness."
        action={<StatusPill tone={report.readinessStatus === "ready" ? "success" : report.readinessStatus === "warning" ? "warning" : "info"} label={report.readinessStatus} />}
      />
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <StatusCard label="Ready" value={readyCount.toString()} />
        <StatusCard label="Warnings" value={warningCount.toString()} />
        <StatusCard label="Missing" value={missingCount.toString()} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onLoadDemoDirectorControls}
          className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
        >
          Load demo Director Controls
        </button>
        <button
          type="button"
          onClick={onGenerateDemoAgentResultJson}
          className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
        >
          Generate demo Agent Result JSON
        </button>
        <button
          type="button"
          onClick={onExportReportMarkdown}
          className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
        >
          Export QA MD
        </button>
        <button
          type="button"
          onClick={onExportReportJson}
          className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
        >
          Export QA JSON
        </button>
      </div>
      <div className="mt-4 max-h-[340px] space-y-2 overflow-auto">
        {checklist.map((item) => (
          <ChecklistItem key={item.id} item={item} />
        ))}
      </div>
      <InlineMessage
        tone="neutral"
        message="Demo result paths are placeholders. They are clearly labeled and should be replaced with real generated files before approval or Premiere execution."
      />
    </div>
  );
}

function ChecklistItem({ item }: { item: WorkflowQaItem }) {
  const tone = item.status === "ready" ? "success" : item.status === "warning" ? "warning" : "info";

  return (
    <div className="rounded-2xl border border-border/70 bg-card/60 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusPill tone={tone} label={item.status} />
        <p className="font-medium text-foreground">{item.label}</p>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.explanation}</p>
      <p className="mt-1 text-xs leading-5 text-sky-200">{item.actionHint}</p>
    </div>
  );
}
