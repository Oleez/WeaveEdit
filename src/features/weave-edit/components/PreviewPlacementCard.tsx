import type { GeneratedAssetMatchSuggestion, ImportedGeneratedAsset, MissingAssetPrompt } from "@/lib/ai/types";
import type { TimelinePlacement } from "@/lib/timeline-plan";
import { formatSeconds } from "@/lib/script-parser";
import { StatusPill, SummaryRow } from "./ui";

interface PreviewPlacementCardProps {
  placement: TimelinePlacement;
  prompt?: MissingAssetPrompt;
  linkedAssets: ImportedGeneratedAsset[];
  generatedAssetSuggestion?: GeneratedAssetMatchSuggestion;
  copiedPromptIds: Record<string, boolean>;
  showAdvancedUi: boolean;
  recipeLabel: string;
  captionStyleLabel: string;
  hasAiTopCandidate: boolean;
  onCopyPrompt: (promptId: string) => void | Promise<void>;
  onSetManualOverride: (segmentId: string, value: string) => void;
  formatProviderName: (provider: string | null) => string;
  formatPlacementStrategy: (strategy: TimelinePlacement["strategy"], lowConfidence: boolean) => string;
  formatEditorialRole: (role: TimelinePlacement["editorialRole"]) => string;
  formatMatchKind: (kind: TimelinePlacement["matchKind"]) => string;
}

export function PreviewPlacementCard({
  placement,
  prompt,
  linkedAssets,
  generatedAssetSuggestion,
  copiedPromptIds,
  showAdvancedUi,
  recipeLabel,
  captionStyleLabel,
  hasAiTopCandidate,
  onCopyPrompt,
  onSetManualOverride,
  formatProviderName,
  formatPlacementStrategy,
  formatEditorialRole,
  formatMatchKind,
}: PreviewPlacementCardProps) {
  return (
    <article className="rounded-3xl border border-border/70 bg-background/60 p-4">
      <div className="flex items-center justify-between gap-4">
        <StatusPill
          tone={
            placement.strategy === "ai"
              ? "info"
              : placement.strategy === "manual"
                ? "success"
                : "warning"
          }
          label={
            placement.lowConfidence
              ? "low-confidence fallback"
              : placement.strategy === "manual"
                ? "manual"
                : placement.strategy
          }
        />
        <span className="font-mono text-xs text-muted-foreground">
          {formatSeconds(placement.startSec)} - {formatSeconds(placement.endSec)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-foreground">{placement.text}</p>
      <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
        <SummaryRow
          label="Media"
          value={placement.mediaName ? `${placement.mediaType ?? "media"} / ${placement.mediaName}` : "blank gap"}
        />
        <SummaryRow
          label="Duration"
          value={`${placement.durationSec.toFixed(2)}s${
            placement.layerIndex > 0 ? ` / overlap V+${placement.layerIndex}` : ""
          }`}
        />
        <SummaryRow label="Role" value={formatEditorialRole(placement.editorialRole)} />
        <SummaryRow label="Strategy" value={formatPlacementStrategy(placement.strategy, placement.lowConfidence)} />
        <SummaryRow label="Provider" value={formatProviderName(placement.aiProvider)} />
        <SummaryRow label="Confidence" value={`${Math.round(placement.aiConfidence * 100)}%`} />
        <SummaryRow label="Match" value={formatMatchKind(placement.matchKind)} />
        <SummaryRow label="Preference" value={placement.mediaPreference ?? "either"} />
        {placement.usingGeneratedAsset ? (
          <>
            <SummaryRow label="Generated" value={placement.generatedAssetSource ?? "approved asset"} />
            <SummaryRow label="Original" value={placement.originalMediaName ?? placement.originalStrategy ?? "blank"} />
          </>
        ) : null}
        <SummaryRow label="Recipe" value={recipeLabel} />
        <SummaryRow label="Captions" value={captionStyleLabel} />
        {placement.mediaType === "video" ? (
          <>
            <SummaryRow
              label="Source"
              value={
                placement.sourceDurationSec
                  ? `${formatSeconds(placement.sourceDurationSec)} total`
                  : "duration unknown"
              }
            />
            <SummaryRow
              label="Source range"
              value={
                placement.sourceInSec !== null && placement.sourceOutSec !== null
                  ? `${formatSeconds(placement.sourceInSec)} - ${formatSeconds(placement.sourceOutSec)}`
                  : "not trimmed"
              }
            />
          </>
        ) : null}
      </div>
      <div className="mt-3 space-y-2 rounded-2xl border border-border/70 bg-card/60 p-3 text-xs">
        {placement.aiRationale ? (
          <p className="leading-5 text-muted-foreground">
            <span className="text-foreground">Match:</span> {placement.aiRationale}
          </p>
        ) : null}
        {placement.timingRationale ? (
          <p className="leading-5 text-muted-foreground">
            <span className="text-foreground">Timing:</span> {placement.timingSource} - {placement.timingRationale}
          </p>
        ) : null}
        {placement.aiVisualMatchReason ? (
          <p className="leading-5 text-muted-foreground">
            <span className="text-foreground">Visual fit:</span> {placement.aiVisualMatchReason}
          </p>
        ) : null}
        {placement.trimNote ? (
          <p className="leading-5 text-muted-foreground">
            <span className="text-foreground">Trim:</span> {placement.trimNote}
          </p>
        ) : null}
        {placement.fallbackReason ? <p className="leading-5 text-amber-300">{placement.fallbackReason}</p> : null}
        {placement.usingGeneratedAsset ? (
          <p className="leading-5 text-emerald-300">
            Using approved generated asset: {placement.generatedAssetRationale}
          </p>
        ) : null}
        {placement.usingGeneratedAsset && generatedAssetSuggestion ? (
          <p className="leading-5 text-emerald-300">
            Generated asset suggested/applied by rerank ({Math.round(generatedAssetSuggestion.confidence * 100)}%):{" "}
            {generatedAssetSuggestion.matchReason}
          </p>
        ) : null}
        {placement.lowConfidence ? (
          <p className="leading-5 text-amber-300">
            Review this placement before executing; it is below the current confidence threshold.
          </p>
        ) : null}
        {prompt ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
            <p className="font-medium text-amber-200">
              Prompt recommended: {prompt.suggestedAssetType} / {prompt.priority}
            </p>
            <p className="mt-1 leading-5 text-amber-100/80">{prompt.reason}</p>
            <p className="mt-1 leading-5 text-amber-100/70">
              {prompt.aiRefined
                ? `AI-refined via ${formatProviderName(prompt.refinementProvider ?? null)}`
                : "Rule-generated prompt"}
            </p>
            <button
              type="button"
              onClick={() => void onCopyPrompt(prompt.id)}
              className="mt-2 rounded-full border border-amber-300/30 px-3 py-1 hover:bg-amber-300/10"
            >
              {copiedPromptIds[prompt.id] ? "Copied prompt" : "Copy prompt"}
            </button>
          </div>
        ) : null}
        {linkedAssets.length > 0 ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
            <p className="font-medium text-emerald-200">Generated asset linked</p>
            <div className="mt-2 space-y-2">
              {linkedAssets.map((asset) => (
                <div key={asset.id}>
                  <p className="text-emerald-100">
                    {asset.fileName} / {asset.status} / {asset.sourceTool}
                  </p>
                                <p className="mt-1 text-emerald-100/70">
                                  {asset.intendedUsage}
                                  {asset.sourceDurationSec ? ` / ${formatSeconds(asset.sourceDurationSec)} source` : " / duration unknown"}
                                  {placement.generatedAssetId === asset.id
                                    ? " / currently used in plan"
                      : asset.status === "approved"
                        ? " / ready for generated-asset replanning"
                                      : ""}
                                </p>
                                {placement.generatedAssetId === asset.id && asset.visualSummary ? (
                                  <p className="mt-1 text-emerald-100/70">
                                    Visual profile: {asset.visualSummary}
                                    {asset.visualKeywords?.length ? ` / ${asset.visualKeywords.slice(0, 6).join(", ")}` : ""}
                                  </p>
                                ) : null}
                              </div>
                            ))}
                          </div>
          </div>
        ) : null}
      </div>
      <div className="hidden">
        <span>
          {placement.mediaName ? `[${placement.mediaType}] ${placement.mediaName}` : "blank gap"}
        </span>
        <span>
          {placement.durationSec.toFixed(2)}s
          {placement.layerIndex > 0 ? ` â€¢ overlap layer ${placement.layerIndex + 1}` : ""}
        </span>
      </div>
      {placement.aiProvider ? (
        <p className="hidden">
          AI {placement.aiProvider} {(placement.aiConfidence * 100).toFixed(0)}%{" "}
          {placement.aiRationale ? `- ${placement.aiRationale}` : ""}
        </p>
      ) : null}
      {placement.timingRationale ? (
        <p className="hidden">
          Timing {placement.timingSource}: {placement.timingRationale}
        </p>
      ) : null}
      {placement.fallbackReason ? <p className="hidden">{placement.fallbackReason}</p> : null}
      {showAdvancedUi ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onSetManualOverride(placement.segmentId, "auto")}
            className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
          >
            Auto
          </button>
          <button
            type="button"
            onClick={() => onSetManualOverride(placement.segmentId, "blank")}
            className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
          >
            Blank
          </button>
          {hasAiTopCandidate ? (
            <button
              type="button"
              onClick={() => onSetManualOverride(placement.segmentId, "ai-top")}
              className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
            >
              Use AI top
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
