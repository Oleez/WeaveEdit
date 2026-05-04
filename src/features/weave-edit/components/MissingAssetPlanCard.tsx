import type { AiMode, ImportedGeneratedAsset, MissingAssetPlan, MissingAssetPrompt } from "@/lib/ai/types";
import type { AssetAttachDraft } from "@/lib/ai/asset-inbox";
import type { AppliedGeneratedAssetMap } from "@/lib/ai/generated-asset-planner";
import type { PromptPlanRefinementResult } from "@/lib/ai/prompt-plan-refiner";
import { formatSeconds } from "@/lib/script-parser";
import { CardHeader, InlineMessage, StatusCard, StatusPill, SummaryRow } from "./ui";

type PromptBriefFormat = "md" | "txt" | "json";

interface MissingAssetPlanCardProps {
  missingAssetPlan: MissingAssetPlan;
  promptRefinementResult: PromptPlanRefinementResult | null;
  promptRefineBusyMessage: string | null;
  refinedMissingAssetPlan: MissingAssetPlan | null;
  aiMode: AiMode;
  assetsByPromptId: Map<string, ImportedGeneratedAsset[]>;
  assetDraftsByPromptId: Record<string, AssetAttachDraft>;
  activeAttachPromptId: string | null;
  copiedPromptIds: Record<string, boolean>;
  appliedGeneratedAssetIdsByPlacementId: AppliedGeneratedAssetMap;
  onRefinePromptPlan: () => void | Promise<void>;
  onCopyAllPrompts: () => void | Promise<void>;
  onExportPromptBrief: (format: PromptBriefFormat) => void;
  onResetAllPrompts: () => void;
  onCopyPrompt: (promptId: string) => void | Promise<void>;
  onResetPrompt: (promptId: string) => void;
  onToggleAttachPrompt: (promptId: string) => void;
  onAttachDraftChange: (promptId: string, patch: Partial<AssetAttachDraft>) => void;
  onAttachGeneratedAsset: (promptId: string) => void;
  onUpdateGeneratedAssetStatus: (assetId: string, status: ImportedGeneratedAsset["status"]) => void;
  onUseGeneratedAssetInPlan: (asset: ImportedGeneratedAsset) => void;
  onRestoreGeneratedAssetPlacement: (placementId: string) => void;
  formatTopPromptType: (plan: MissingAssetPlan) => string;
  formatProviderName: (provider: string | null) => string;
  formatEditorialRole: (role: MissingAssetPrompt["editorialRole"]) => string;
}

export function MissingAssetPlanCard({
  missingAssetPlan,
  promptRefinementResult,
  promptRefineBusyMessage,
  refinedMissingAssetPlan,
  aiMode,
  assetsByPromptId,
  assetDraftsByPromptId,
  activeAttachPromptId,
  copiedPromptIds,
  appliedGeneratedAssetIdsByPlacementId,
  onRefinePromptPlan,
  onCopyAllPrompts,
  onExportPromptBrief,
  onResetAllPrompts,
  onCopyPrompt,
  onResetPrompt,
  onToggleAttachPrompt,
  onAttachDraftChange,
  onAttachGeneratedAsset,
  onUpdateGeneratedAssetStatus,
  onUseGeneratedAssetInPlan,
  onRestoreGeneratedAssetPlacement,
  formatTopPromptType,
  formatProviderName,
  formatEditorialRole,
}: MissingAssetPlanCardProps) {
  return (
    <div className="rounded-3xl border border-border/70 bg-background/60 p-4">
      <CardHeader
        eyebrow="Missing Asset Plan"
        title="Prompt Plan"
        description="Draft briefs for weak, blank, or generated-ready moments. Nothing is generated or imported yet."
        action={
          <StatusPill
            tone={missingAssetPlan.prompts.length > 0 ? "warning" : "success"}
            label={`${missingAssetPlan.prompts.length} prompts`}
          />
        }
      />
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <StatusCard label="Prompt count" value={missingAssetPlan.prompts.length.toString()} />
        <StatusCard label="High priority" value={missingAssetPlan.highPriorityCount.toString()} />
        <StatusCard
          label="Top type"
          value={missingAssetPlan.prompts.length ? formatTopPromptType(missingAssetPlan) : "No missing assets"}
        />
        <StatusCard
          label="Prompt source"
          value={
            promptRefinementResult?.refinedCount
              ? `AI-refined ${promptRefinementResult.refinedCount} via ${formatProviderName(promptRefinementResult.providerUsed)}`
              : "Rule-generated"
          }
        />
      </div>
      {missingAssetPlan.prompts.length > 0 ? (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onRefinePromptPlan()}
              disabled={Boolean(promptRefineBusyMessage) || aiMode === "off"}
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {promptRefineBusyMessage ?? "Refine prompts with AI"}
            </button>
            <button
              type="button"
              onClick={() => void onCopyAllPrompts()}
              className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
            >
              Copy all prompts
            </button>
            <button
              type="button"
              onClick={() => onExportPromptBrief("md")}
              className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
            >
              Export MD
            </button>
            <button
              type="button"
              onClick={() => onExportPromptBrief("txt")}
              className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
            >
              Export TXT
            </button>
            <button
              type="button"
              onClick={() => onExportPromptBrief("json")}
              className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
            >
              Export JSON
            </button>
            {refinedMissingAssetPlan ? (
              <button
                type="button"
                onClick={onResetAllPrompts}
                className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
              >
                Reset all to rules
              </button>
            ) : null}
          </div>
          {aiMode === "off" ? (
            <InlineMessage
              tone="warning"
              message="Turn AI mode to Local or Hybrid to refine prompts. Rule-generated prompts remain available."
            />
          ) : null}
          {promptRefinementResult?.errors.length ? (
            <InlineMessage
              tone="warning"
              message={`Prompt refinement kept safe fallbacks: ${promptRefinementResult.errors.slice(0, 2).join(" | ")}`}
            />
          ) : null}
          <div className="mt-4 max-h-[360px] space-y-3 overflow-auto">
            {missingAssetPlan.prompts.map((prompt) => {
              const linkedAssets = assetsByPromptId.get(prompt.id) ?? [];
              const draft = assetDraftsByPromptId[prompt.id] ?? {
                filePath: "",
                sourceTool: "Manual",
                notes: "",
              };

              return (
                <PromptCard
                  key={prompt.id}
                  prompt={prompt}
                  linkedAssets={linkedAssets}
                  draft={draft}
                  activeAttachPromptId={activeAttachPromptId}
                  copiedPromptIds={copiedPromptIds}
                  appliedGeneratedAssetIdsByPlacementId={appliedGeneratedAssetIdsByPlacementId}
                  onCopyPrompt={onCopyPrompt}
                  onResetPrompt={onResetPrompt}
                  onToggleAttachPrompt={onToggleAttachPrompt}
                  onAttachDraftChange={onAttachDraftChange}
                  onAttachGeneratedAsset={onAttachGeneratedAsset}
                  onUpdateGeneratedAssetStatus={onUpdateGeneratedAssetStatus}
                  onUseGeneratedAssetInPlan={onUseGeneratedAssetInPlan}
                  onRestoreGeneratedAssetPlacement={onRestoreGeneratedAssetPlacement}
                  formatProviderName={formatProviderName}
                  formatEditorialRole={formatEditorialRole}
                />
              );
            })}
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No prompt briefs needed for this preview. Strong local matches can go straight to review.
        </p>
      )}
    </div>
  );
}

interface PromptCardProps {
  prompt: MissingAssetPrompt;
  linkedAssets: ImportedGeneratedAsset[];
  draft: AssetAttachDraft;
  activeAttachPromptId: string | null;
  copiedPromptIds: Record<string, boolean>;
  appliedGeneratedAssetIdsByPlacementId: AppliedGeneratedAssetMap;
  onCopyPrompt: (promptId: string) => void | Promise<void>;
  onResetPrompt: (promptId: string) => void;
  onToggleAttachPrompt: (promptId: string) => void;
  onAttachDraftChange: (promptId: string, patch: Partial<AssetAttachDraft>) => void;
  onAttachGeneratedAsset: (promptId: string) => void;
  onUpdateGeneratedAssetStatus: (assetId: string, status: ImportedGeneratedAsset["status"]) => void;
  onUseGeneratedAssetInPlan: (asset: ImportedGeneratedAsset) => void;
  onRestoreGeneratedAssetPlacement: (placementId: string) => void;
  formatProviderName: (provider: string | null) => string;
  formatEditorialRole: (role: MissingAssetPrompt["editorialRole"]) => string;
}

function PromptCard({
  prompt,
  linkedAssets,
  draft,
  activeAttachPromptId,
  copiedPromptIds,
  appliedGeneratedAssetIdsByPlacementId,
  onCopyPrompt,
  onResetPrompt,
  onToggleAttachPrompt,
  onAttachDraftChange,
  onAttachGeneratedAsset,
  onUpdateGeneratedAssetStatus,
  onUseGeneratedAssetInPlan,
  onRestoreGeneratedAssetPlacement,
  formatProviderName,
  formatEditorialRole,
}: PromptCardProps) {
  return (
    <article className="rounded-2xl border border-border/70 bg-card/60 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusPill
          tone={prompt.priority === "high" ? "warning" : "info"}
          label={`${prompt.priority} / ${prompt.suggestedAssetType}`}
        />
        <span className="font-mono text-xs text-muted-foreground">
          {formatSeconds(prompt.startSec)} - {formatSeconds(prompt.endSec)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-foreground">{prompt.transcriptText}</p>
      <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
        <SummaryRow label="Need" value={prompt.usage} />
        <SummaryRow label="Tool" value={prompt.suggestedToolCategory} />
        <SummaryRow label="Role" value={formatEditorialRole(prompt.editorialRole)} />
        <SummaryRow label="Mode" value={prompt.visualMode} />
      </div>
      {linkedAssets.length > 0 ? (
        <div className="mt-3 space-y-2 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs">
          {linkedAssets.map((asset) => (
            <div key={asset.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-emerald-100">
                {asset.fileName} / {asset.status} / {asset.sourceTool}
                {appliedGeneratedAssetIdsByPlacementId[asset.linkedPlacementId] === asset.id ? " / in plan" : ""}
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onUpdateGeneratedAssetStatus(asset.id, "approved")}
                  className="rounded-full border border-emerald-300/30 px-2 py-1 hover:bg-emerald-300/10"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateGeneratedAssetStatus(asset.id, "rejected")}
                  className="rounded-full border border-emerald-300/30 px-2 py-1 hover:bg-emerald-300/10"
                >
                  Reject
                </button>
                {appliedGeneratedAssetIdsByPlacementId[asset.linkedPlacementId] === asset.id ? (
                  <button
                    type="button"
                    onClick={() => onRestoreGeneratedAssetPlacement(asset.linkedPlacementId)}
                    className="rounded-full border border-emerald-300/30 px-2 py-1 hover:bg-emerald-300/10"
                  >
                    Remove from plan
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onUseGeneratedAssetInPlan(asset)}
                    disabled={asset.status !== "approved"}
                    className="rounded-full border border-emerald-300/30 px-2 py-1 hover:bg-emerald-300/10 disabled:opacity-50"
                  >
                    Use in plan
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <p className="mt-3 text-xs leading-5 text-amber-300">{prompt.reason}</p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Source:{" "}
        <span className="text-foreground">
          {prompt.aiRefined
            ? `AI-refined via ${formatProviderName(prompt.refinementProvider ?? null)}`
            : "rule-generated"}
        </span>
        {prompt.refinementNote ? ` - ${prompt.refinementNote}` : ""}
      </p>
      <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{prompt.promptText}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onCopyPrompt(prompt.id)}
          className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
        >
          {copiedPromptIds[prompt.id] ? "Copied" : "Copy prompt"}
        </button>
        {prompt.aiRefined ? (
          <button
            type="button"
            onClick={() => onResetPrompt(prompt.id)}
            className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
          >
            Reset to rule prompt
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onToggleAttachPrompt(prompt.id)}
          className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
        >
          Attach generated asset
        </button>
      </div>
      {activeAttachPromptId === prompt.id ? (
        <div className="mt-3 grid gap-3 rounded-2xl border border-border/70 bg-background/50 p-3 text-xs">
          <label className="grid gap-1">
            <span className="text-muted-foreground">Local file path</span>
            <input
              value={draft.filePath}
              onChange={(event) => onAttachDraftChange(prompt.id, { filePath: event.target.value })}
              placeholder="H:\Generated\money-dashboard-shot.mp4"
              className="rounded-xl border border-border/70 bg-card px-3 py-2 outline-none transition focus:border-primary"
            />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-muted-foreground">Source tool / provider</span>
              <input
                value={draft.sourceTool}
                onChange={(event) => onAttachDraftChange(prompt.id, { sourceTool: event.target.value })}
                placeholder="Kling, Seedance, Runway, Manual, Other"
                className="rounded-xl border border-border/70 bg-card px-3 py-2 outline-none transition focus:border-primary"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-muted-foreground">Notes</span>
              <input
                value={draft.notes}
                onChange={(event) => onAttachDraftChange(prompt.id, { notes: event.target.value })}
                placeholder="Good take, needs review, alpha pass..."
                className="rounded-xl border border-border/70 bg-card px-3 py-2 outline-none transition focus:border-primary"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => onAttachGeneratedAsset(prompt.id)}
            disabled={!draft.filePath.trim()}
            className="w-fit rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            Link asset to prompt
          </button>
        </div>
      ) : null}
    </article>
  );
}
