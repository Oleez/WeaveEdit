import type { GeneratedAssetMatchSuggestion, GeneratedAssetRerankResult } from "@/lib/ai/types";
import { formatSeconds } from "@/lib/script-parser";
import { CardHeader, InlineMessage, StatusCard, StatusPill, SummaryRow } from "./ui";

interface GeneratedAssetSuggestionsCardProps {
  rerankResult: GeneratedAssetRerankResult | null;
  allowReplacingStrongMatches: boolean;
  onAllowReplacingStrongMatchesChange: (value: boolean) => void;
  onBuildSuggestions: () => void;
  onApplySuggestion: (suggestion: GeneratedAssetMatchSuggestion) => void;
  onApplyAllSafeSuggestions: () => void;
  onDismissSuggestion: (suggestionId: string) => void;
}

export function GeneratedAssetSuggestionsCard({
  rerankResult,
  allowReplacingStrongMatches,
  onAllowReplacingStrongMatchesChange,
  onBuildSuggestions,
  onApplySuggestion,
  onApplyAllSafeSuggestions,
  onDismissSuggestion,
}: GeneratedAssetSuggestionsCardProps) {
  const suggestions = rerankResult?.suggestions ?? [];

  return (
    <div className="rounded-3xl border border-border/70 bg-background/60 p-4">
      <CardHeader
        eyebrow="Generated Asset Matches"
        title="Re-plan Suggestions"
        description="Safely suggest approved generated assets for weak, blank, fallback, or prompt-recommended placements."
        action={<StatusPill tone={suggestions.length > 0 ? "info" : "success"} label={`${suggestions.length} suggestions`} />}
      />
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <StatusCard label="Suggestions" value={suggestions.length.toString()} />
        <StatusCard label="High confidence" value={(rerankResult?.highConfidenceCount ?? 0).toString()} />
        <StatusCard label="Skipped" value={(rerankResult?.skippedCount ?? 0).toString()} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBuildSuggestions}
          className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition"
        >
          Suggest generated asset matches
        </button>
        <button
          type="button"
          onClick={onApplyAllSafeSuggestions}
          disabled={suggestions.length === 0}
          className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
        >
          Apply all safe suggestions
        </button>
        <label className="flex items-center gap-2 rounded-full border border-border/70 px-4 py-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={allowReplacingStrongMatches}
            onChange={(event) => onAllowReplacingStrongMatchesChange(event.target.checked)}
            className="accent-primary"
          />
          Allow replacing strong matches
        </label>
      </div>
      {rerankResult?.skippedReasons.length ? (
        <InlineMessage
          tone="neutral"
          message={`Skipped: ${rerankResult.skippedReasons.slice(0, 2).join(" | ")}`}
        />
      ) : null}
      {suggestions.length > 0 ? (
        <div className="mt-4 max-h-[320px] space-y-3 overflow-auto">
          {suggestions.map((suggestion) => (
            <SuggestionCard
              key={suggestion.id}
              suggestion={suggestion}
              onApplySuggestion={onApplySuggestion}
              onDismissSuggestion={onDismissSuggestion}
            />
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No suggestions yet. Run matching after approving and analyzing generated image/video assets.
        </p>
      )}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  onApplySuggestion,
  onDismissSuggestion,
}: {
  suggestion: GeneratedAssetMatchSuggestion;
  onApplySuggestion: (suggestion: GeneratedAssetMatchSuggestion) => void;
  onDismissSuggestion: (suggestionId: string) => void;
}) {
  return (
    <article className="rounded-2xl border border-border/70 bg-card/60 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusPill
          tone={suggestion.applyStatus === "applied" ? "success" : suggestion.confidence >= 0.68 ? "info" : "warning"}
          label={`${Math.round(suggestion.confidence * 100)}% / ${suggestion.applyStatus}`}
        />
        <span className="font-mono text-xs text-muted-foreground">
          {formatSeconds(suggestion.startSec)} - {formatSeconds(suggestion.endSec)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-foreground">{suggestion.assetFileName}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{suggestion.transcriptText}</p>
      <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
        <SummaryRow label="Replaces" value={suggestion.replaces} />
        <SummaryRow label="Match" value={suggestion.matchKind} />
        <SummaryRow label="Source" value={suggestion.sourceTool} />
        <SummaryRow label="Placement" value={suggestion.placementId} />
      </div>
      <p className="mt-3 text-xs leading-5 text-sky-200">{suggestion.matchReason}</p>
      {suggestion.assetVisualSummary ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{suggestion.assetVisualSummary}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onApplySuggestion(suggestion)}
          disabled={suggestion.applyStatus === "applied"}
          className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
        >
          Apply suggestion
        </button>
        <button
          type="button"
          onClick={() => onDismissSuggestion(suggestion.id)}
          className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
        >
          Dismiss
        </button>
      </div>
    </article>
  );
}
