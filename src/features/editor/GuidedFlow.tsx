import { Check } from "lucide-react";

export interface GuidedFlowProps {
  hasTranscript: boolean;
  hasPreviewPlan: boolean;
  hasApplied: boolean;
  busy?: boolean;
  onLoadTranscript: () => void;
  onAutopilot: () => void;
  onApply: () => void;
}

/**
 * Three-step strip that tells a first-time user exactly what to do, in order,
 * with live checkmarks. Each step is clickable and triggers the real action.
 */
export function GuidedFlow({
  hasTranscript,
  hasPreviewPlan,
  hasApplied,
  busy,
  onLoadTranscript,
  onAutopilot,
  onApply,
}: GuidedFlowProps) {
  const steps = [
    {
      title: "Load your video's transcript",
      description: "Premiere markers or an SRT file. This tells the editor what is said and when.",
      done: hasTranscript,
      enabled: true,
      onClick: onLoadTranscript,
    },
    {
      title: "Weave builds the edit",
      description: "Cuts silence, places B-roll, plans captions and audio. Nothing touches Premiere yet.",
      done: hasPreviewPlan,
      enabled: hasTranscript && !busy,
      onClick: onAutopilot,
    },
    {
      title: "Apply to Premiere",
      description: "Review the preview below, then press Apply. Undo anytime from History.",
      done: hasApplied,
      enabled: hasPreviewPlan && !busy,
      onClick: onApply,
    },
  ];

  return (
    <div className="grid gap-2 border-b border-border/70 bg-card/60 px-4 py-2.5 md:grid-cols-3">
      {steps.map((step, index) => (
        <button
          key={step.title}
          type="button"
          onClick={step.onClick}
          disabled={!step.enabled}
          className={`flex items-start gap-2.5 rounded-md border px-3 py-2 text-left transition ${
            step.done
              ? "border-emerald-500/40 bg-emerald-500/10"
              : step.enabled
                ? "border-border/70 bg-background/60 hover:bg-accent"
                : "border-border/50 bg-background/40 opacity-60"
          }`}
        >
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
              step.done ? "bg-emerald-500 text-emerald-950" : "bg-muted text-muted-foreground"
            }`}
          >
            {step.done ? <Check className="h-3 w-3" /> : index + 1}
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold leading-4">{step.title}</span>
            <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{step.description}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
