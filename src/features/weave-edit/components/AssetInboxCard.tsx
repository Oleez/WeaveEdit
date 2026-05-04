import type { ImportedGeneratedAsset } from "@/lib/ai/types";
import type { AppliedGeneratedAssetMap, GeneratedAssetApplySummary } from "@/lib/ai/generated-asset-planner";
import { formatSeconds } from "@/lib/script-parser";
import { CardHeader, InlineMessage, StatusCard, StatusPill, SummaryRow } from "./ui";

export type AssetStatusFilter = ImportedGeneratedAsset["status"] | "all";
export type AssetTypeFilter = ImportedGeneratedAsset["fileType"] | "all";

interface AssetInboxCardProps {
  generatedAssets: ImportedGeneratedAsset[];
  filteredGeneratedAssets: ImportedGeneratedAsset[];
  assetStatusFilter: AssetStatusFilter;
  assetTypeFilter: AssetTypeFilter;
  assetAnalysisBusyIds: Record<string, boolean>;
  assetAnalysisBusyMessage: string | null;
  generatedAssetApplySummary: GeneratedAssetApplySummary | null;
  appliedGeneratedAssetIdsByPlacementId: AppliedGeneratedAssetMap;
  canUseApprovedAssets: boolean;
  canAnalyzeAssets: boolean;
  onAnalyzeAllGeneratedAssets: () => void | Promise<void>;
  onUseAllApprovedAssetsInPlan: () => void;
  onRestoreAllGeneratedAssetPlacements: () => void;
  onStatusFilterChange: (value: AssetStatusFilter) => void;
  onTypeFilterChange: (value: AssetTypeFilter) => void;
  onExportAssetInbox: (format: "json" | "csv") => void;
  onCopyGeneratedAssetPath: (asset: ImportedGeneratedAsset) => void | Promise<void>;
  onProbeGeneratedAssetDuration: (assetId: string) => void;
  onAnalyzeGeneratedAsset: (asset: ImportedGeneratedAsset) => void;
  onUpdateGeneratedAssetStatus: (assetId: string, status: ImportedGeneratedAsset["status"]) => void;
  onUseGeneratedAssetInPlan: (asset: ImportedGeneratedAsset) => void;
  onRestoreGeneratedAssetPlacement: (placementId: string) => void;
  onUnlinkGeneratedAsset: (assetId: string) => void;
}

export function AssetInboxCard({
  generatedAssets,
  filteredGeneratedAssets,
  assetStatusFilter,
  assetTypeFilter,
  assetAnalysisBusyIds,
  assetAnalysisBusyMessage,
  generatedAssetApplySummary,
  appliedGeneratedAssetIdsByPlacementId,
  canUseApprovedAssets,
  canAnalyzeAssets,
  onAnalyzeAllGeneratedAssets,
  onUseAllApprovedAssetsInPlan,
  onRestoreAllGeneratedAssetPlacements,
  onStatusFilterChange,
  onTypeFilterChange,
  onExportAssetInbox,
  onCopyGeneratedAssetPath,
  onProbeGeneratedAssetDuration,
  onAnalyzeGeneratedAsset,
  onUpdateGeneratedAssetStatus,
  onUseGeneratedAssetInPlan,
  onRestoreGeneratedAssetPlacement,
  onUnlinkGeneratedAsset,
}: AssetInboxCardProps) {
  const approvedCount = generatedAssets.filter((asset) => asset.status === "approved").length;

  return (
    <div className="rounded-3xl border border-border/70 bg-background/60 p-4">
      <CardHeader
        eyebrow="Asset Inbox"
        title="Generated Asset Inbox"
        description="Manually link generated files back to prompt ids now; future automation can write the same records."
        action={<StatusPill tone={generatedAssets.length > 0 ? "info" : "success"} label={`${generatedAssets.length} assets`} />}
      />
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <StatusCard label="Imported" value={generatedAssets.length.toString()} />
        <StatusCard label="Approved" value={approvedCount.toString()} />
        <StatusCard label="Ready later" value="Manual linking only" />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onAnalyzeAllGeneratedAssets()}
          disabled={!canAnalyzeAssets || Boolean(assetAnalysisBusyMessage)}
          className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
        >
          {assetAnalysisBusyMessage ?? "Analyze all"}
        </button>
        <button
          type="button"
          onClick={onUseAllApprovedAssetsInPlan}
          disabled={!canUseApprovedAssets}
          className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          Use all approved assets in plan
        </button>
        <button
          type="button"
          onClick={onRestoreAllGeneratedAssetPlacements}
          disabled={Object.keys(appliedGeneratedAssetIdsByPlacementId).length === 0}
          className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
        >
          Restore original placements
        </button>
        <select
          value={assetStatusFilter}
          onChange={(event) => onStatusFilterChange(event.target.value as AssetStatusFilter)}
          className="rounded-full border border-border/70 bg-card px-3 py-2 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="imported">Imported</option>
          <option value="reviewed">Reviewed</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select
          value={assetTypeFilter}
          onChange={(event) => onTypeFilterChange(event.target.value as AssetTypeFilter)}
          className="rounded-full border border-border/70 bg-card px-3 py-2 text-sm"
        >
          <option value="all">All types</option>
          <option value="image">Image</option>
          <option value="video">Video</option>
          <option value="audio">Audio</option>
          <option value="alpha">Alpha</option>
          <option value="other">Other</option>
        </select>
        <button
          type="button"
          onClick={() => onExportAssetInbox("json")}
          disabled={generatedAssets.length === 0}
          className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
        >
          Export JSON
        </button>
        <button
          type="button"
          onClick={() => onExportAssetInbox("csv")}
          disabled={generatedAssets.length === 0}
          className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>
      {generatedAssetApplySummary ? (
        <InlineMessage
          tone={generatedAssetApplySummary.skippedCount > 0 ? "warning" : "success"}
          message={`Generated asset plan update: ${generatedAssetApplySummary.updatedCount} updated, ${generatedAssetApplySummary.skippedCount} skipped${
            generatedAssetApplySummary.skippedReasons.length
              ? `. ${generatedAssetApplySummary.skippedReasons.slice(0, 2).join(" | ")}`
              : "."
          }`}
        />
      ) : null}
      {filteredGeneratedAssets.length > 0 ? (
        <div className="mt-4 max-h-[300px] space-y-3 overflow-auto">
          {filteredGeneratedAssets.map((asset) => {
            const isApplied = appliedGeneratedAssetIdsByPlacementId[asset.linkedPlacementId] === asset.id;

            return (
              <AssetInboxItem
                key={asset.id}
                asset={asset}
                isApplied={isApplied}
                isAnalyzing={Boolean(assetAnalysisBusyIds[asset.id])}
                onCopyGeneratedAssetPath={onCopyGeneratedAssetPath}
                onProbeGeneratedAssetDuration={onProbeGeneratedAssetDuration}
                onAnalyzeGeneratedAsset={onAnalyzeGeneratedAsset}
                onUpdateGeneratedAssetStatus={onUpdateGeneratedAssetStatus}
                onUseGeneratedAssetInPlan={onUseGeneratedAssetInPlan}
                onRestoreGeneratedAssetPlacement={onRestoreGeneratedAssetPlacement}
                onUnlinkGeneratedAsset={onUnlinkGeneratedAsset}
              />
            );
          })}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No generated assets match the current filters. Attach one from a prompt card when a file is ready.
        </p>
      )}
      <InlineMessage
        tone="info"
        message="Approved generated assets are organized here for future replanning. This phase does not auto-replace timeline placements."
      />
    </div>
  );
}

interface AssetInboxItemProps {
  asset: ImportedGeneratedAsset;
  isApplied: boolean;
  isAnalyzing: boolean;
  onCopyGeneratedAssetPath: (asset: ImportedGeneratedAsset) => void | Promise<void>;
  onProbeGeneratedAssetDuration: (assetId: string) => void;
  onAnalyzeGeneratedAsset: (asset: ImportedGeneratedAsset) => void;
  onUpdateGeneratedAssetStatus: (assetId: string, status: ImportedGeneratedAsset["status"]) => void;
  onUseGeneratedAssetInPlan: (asset: ImportedGeneratedAsset) => void;
  onRestoreGeneratedAssetPlacement: (placementId: string) => void;
  onUnlinkGeneratedAsset: (assetId: string) => void;
}

function AssetInboxItem({
  asset,
  isApplied,
  isAnalyzing,
  onCopyGeneratedAssetPath,
  onProbeGeneratedAssetDuration,
  onAnalyzeGeneratedAsset,
  onUpdateGeneratedAssetStatus,
  onUseGeneratedAssetInPlan,
  onRestoreGeneratedAssetPlacement,
  onUnlinkGeneratedAsset,
}: AssetInboxItemProps) {
  return (
    <article className="rounded-2xl border border-border/70 bg-card/60 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusPill
          tone={asset.status === "approved" ? "success" : asset.status === "rejected" ? "warning" : "info"}
          label={`${asset.fileType} / ${asset.status}${isApplied ? " / in plan" : ""}`}
        />
        <span className="font-mono text-xs text-muted-foreground">
          {formatSeconds(asset.timestampStartSec)} - {formatSeconds(asset.timestampEndSec)}
        </span>
      </div>
      <p className="mt-3 font-medium text-foreground">{asset.fileName}</p>
      <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{asset.filePath}</p>
      <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
        <SummaryRow label="Prompt" value={asset.linkedPromptId} />
        <SummaryRow label="Source" value={asset.sourceTool} />
        <SummaryRow label="Usage" value={asset.intendedUsage} />
        <SummaryRow label="Requested" value={asset.requestedAssetType} />
        <SummaryRow
          label="Duration"
          value={asset.sourceDurationSec ? formatSeconds(asset.sourceDurationSec) : asset.durationProbeStatus ?? "not probed"}
        />
        <SummaryRow label="Probe" value={asset.durationProbeNote ?? "No duration metadata"} />
        <SummaryRow label="Analysis" value={asset.analysisStatus ?? "not analyzed"} />
        <SummaryRow label="Analyzer" value={asset.analysisProvider ?? "none"} />
      </div>
      {asset.visualSummary ? (
        <div className="mt-3 rounded-2xl border border-sky-500/25 bg-sky-500/10 p-3 text-xs">
          <p className="leading-5 text-sky-100">{asset.visualSummary}</p>
          <p className="mt-2 text-sky-100/70">
            {[...(asset.visualKeywords ?? []), ...(asset.moodTags ?? []), ...(asset.visualStyle ?? [])]
              .slice(0, 12)
              .join(", ")}
          </p>
          {asset.likelyUseCases?.length ? (
            <p className="mt-1 text-sky-100/70">Use cases: {asset.likelyUseCases.slice(0, 4).join(", ")}</p>
          ) : null}
        </div>
      ) : null}
      {asset.analysisNote ? <p className="mt-3 text-xs text-muted-foreground">{asset.analysisNote}</p> : null}
      {asset.notes ? <p className="mt-3 text-xs text-muted-foreground">{asset.notes}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onCopyGeneratedAssetPath(asset)}
          className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
        >
          Copy path
        </button>
        {asset.fileType === "video" ? (
          <button
            type="button"
            onClick={() => onProbeGeneratedAssetDuration(asset.id)}
            className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
          >
            Refresh metadata
          </button>
        ) : null}
        {asset.fileType === "image" || asset.fileType === "video" ? (
          <button
            type="button"
            onClick={() => onAnalyzeGeneratedAsset(asset)}
            disabled={isAnalyzing}
            className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
          >
            {isAnalyzing ? "Analyzing" : asset.analysisStatus === "available" ? "Reanalyze asset" : "Analyze asset"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onUpdateGeneratedAssetStatus(asset.id, "reviewed")}
          className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
        >
          Mark reviewed
        </button>
        <button
          type="button"
          onClick={() => onUpdateGeneratedAssetStatus(asset.id, "approved")}
          className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => onUpdateGeneratedAssetStatus(asset.id, "rejected")}
          className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
        >
          Reject
        </button>
        {isApplied ? (
          <button
            type="button"
            onClick={() => onRestoreGeneratedAssetPlacement(asset.linkedPlacementId)}
            className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
          >
            Remove from plan
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onUseGeneratedAssetInPlan(asset)}
            disabled={asset.status !== "approved"}
            className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
          >
            Use in plan
          </button>
        )}
        <button
          type="button"
          onClick={() => onUnlinkGeneratedAsset(asset.id)}
          className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
        >
          Unlink
        </button>
      </div>
    </article>
  );
}
