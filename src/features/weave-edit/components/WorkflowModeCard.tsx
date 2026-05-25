import { CardHeader, StatusPill, SummaryRow } from "./ui";

export type WorkflowMode = "manual-folder-order" | "ai-smart-broll" | "generated-asset-workflow" | "long-to-shorts";

interface WorkflowModeCardProps {
  activeMode: WorkflowMode;
  providerLabel: string;
  modelLabel: string;
  fallbackLabel: string;
  indexedAssets: number;
  profiledAssets: number;
  confidenceThreshold: number;
  canAnalyze: boolean;
  aiBusyMessage: string | null;
  onModeChange: (mode: WorkflowMode) => void;
  onCheckProviders: () => void | Promise<void>;
  onAnalyzeWithAi: () => void | Promise<void>;
}

const modes: Array<{
  id: WorkflowMode;
  title: string;
  description: string;
}> = [
  {
    id: "manual-folder-order",
    title: "Manual Folder Order",
    description: "Places media in scanned order. Fast and deterministic. AI semantic matching is bypassed.",
  },
  {
    id: "ai-smart-broll",
    title: "AI Smart B-roll",
    description: "Uses Gemma/Ollama primary and Gemini fallback to match visuals to transcript meaning.",
  },
  {
    id: "generated-asset-workflow",
    title: "Generated Asset Workflow",
    description: "Uses Prompt Plan, Asset Inbox, Agent Handoff, and generated asset matching for missing visuals.",
  },
  {
    id: "long-to-shorts",
    title: "Long to Shorts",
    description: "Finds 30-90s short-form moments inside a long transcript, then exports notes or markers.",
  },
];

export function WorkflowModeCard({
  activeMode,
  providerLabel,
  modelLabel,
  fallbackLabel,
  indexedAssets,
  profiledAssets,
  confidenceThreshold,
  canAnalyze,
  aiBusyMessage,
  onModeChange,
  onCheckProviders,
  onAnalyzeWithAi,
}: WorkflowModeCardProps) {
  const isManual = activeMode === "manual-folder-order";
  const isShorts = activeMode === "long-to-shorts";

  return (
    <div className="rounded-[28px] border border-border/70 bg-card/95 p-5 shadow-xl shadow-black/10">
      <CardHeader
        eyebrow="Workflow Mode"
        title="Choose How WeaveEdit Plans"
        description="Pick the main editing path first; advanced controls stay available when you need them."
        action={<StatusPill tone={isManual ? "warning" : "info"} label={modes.find((mode) => mode.id === activeMode)?.title ?? "Workflow"} />}
      />
      <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
        {modes.map((mode) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => onModeChange(mode.id)}
            className={`rounded-3xl border p-4 text-left transition hover:bg-accent ${
              activeMode === mode.id
                ? "border-primary/60 bg-primary/10"
                : "border-border/70 bg-background/60"
            }`}
          >
            <p className="text-sm font-semibold text-foreground">{mode.title}</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{mode.description}</p>
          </button>
        ))}
      </div>
      <div className={`mt-4 rounded-3xl border px-4 py-3 text-sm ${isManual ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-sky-500/30 bg-sky-500/10 text-sky-100"}`}>
        {isManual
          ? "Manual Folder Order is active. Gemma is not selecting B-roll in this preview. Switch to AI Smart B-roll to use semantic matching, missing asset prompts, and generated asset suggestions."
          : isShorts
            ? "Shorts Extractor mode is active. Transcript is the input; B-roll workflows stay available per selected short."
            : "AI Smart B-roll is active. Check providers, then analyze with AI to let Gemma/Ollama review transcript meaning and media fit."}
      </div>
      {!isManual && !isShorts ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
          <div className="grid gap-2 rounded-3xl border border-border/70 bg-background/60 p-4 text-sm">
            <SummaryRow label="Active provider" value={providerLabel} />
            <SummaryRow label="Model" value={modelLabel} />
            <SummaryRow label="Fallback" value={fallbackLabel} />
            <SummaryRow label="Indexed / profiled" value={`${indexedAssets} / ${profiledAssets}`} />
            <SummaryRow label="Confidence" value={`${Math.round(confidenceThreshold * 100)}% threshold`} />
          </div>
          <div className="flex min-w-[220px] flex-col gap-2">
            <button
              type="button"
              onClick={() => void onCheckProviders()}
              className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
            >
              Check Providers
            </button>
            <button
              type="button"
              onClick={() => void onAnalyzeWithAi()}
              disabled={!canAnalyze}
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {aiBusyMessage ?? "Analyze with AI"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
