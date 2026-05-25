import type {
  AiMode,
  ShortCandidate,
  ShortExtractionResult,
  ShortExtractionSettings,
  ShortGoal,
  ShortHookStyle,
  ShortPlatform,
} from "@/lib/ai/types";
import { formatSeconds } from "@/lib/script-parser";
import { CardHeader, DirectionSelect, InlineMessage, StatusPill, SummaryRow } from "./ui";

interface ShortsExtractorCardProps {
  settings: ShortExtractionSettings;
  result: ShortExtractionResult | null;
  busy: boolean;
  error: string | null;
  aiMode: AiMode;
  hasTranscript: boolean;
  selectedIds: Set<string>;
  scopedRangeLabel?: string | null;
  onSettingsChange: (settings: ShortExtractionSettings) => void;
  onFind: () => void | Promise<void>;
  onToggleSelect: (candidateId: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onCreateMarkers: () => void | Promise<void>;
  onExportJson: () => void;
  onExportCsv: () => void;
  onCopyTitle: (candidate: ShortCandidate) => void | Promise<void>;
  onCopyHook: (candidate: ShortCandidate) => void | Promise<void>;
  onCopyNotes: (candidate: ShortCandidate) => void | Promise<void>;
  onSendToBrollWorkflow: (candidate: ShortCandidate) => void;
}

const durationOptions: Array<{ value: "30" | "45" | "60" | "90"; label: string }> = [
  { value: "30", label: "30 sec" },
  { value: "45", label: "45 sec" },
  { value: "60", label: "60 sec" },
  { value: "90", label: "90 sec" },
];

const countOptions: Array<{ value: "1" | "3" | "5" | "10"; label: string }> = [
  { value: "1", label: "1 clip" },
  { value: "3", label: "3 clips" },
  { value: "5", label: "5 clips" },
  { value: "10", label: "10 clips" },
];

const platformOptions: Array<{ value: ShortPlatform; label: string }> = [
  { value: "youtube-shorts", label: "YouTube Shorts" },
  { value: "instagram-reels", label: "Instagram Reels" },
  { value: "tiktok", label: "TikTok" },
  { value: "linkedin", label: "LinkedIn" },
];

const goalOptions: Array<{ value: ShortGoal; label: string }> = [
  { value: "retention", label: "Retention" },
  { value: "leads", label: "Leads" },
  { value: "sales", label: "Sales" },
  { value: "authority", label: "Authority" },
  { value: "education", label: "Education" },
  { value: "controversy", label: "Controversy" },
  { value: "story", label: "Story" },
];

const hookOptions: Array<{ value: ShortHookStyle; label: string }> = [
  { value: "shocking", label: "Shocking" },
  { value: "curiosity", label: "Curiosity" },
  { value: "value", label: "Value" },
  { value: "emotional", label: "Emotional" },
  { value: "contrarian", label: "Contrarian" },
  { value: "story", label: "Story" },
];

export function ShortsExtractorCard({
  settings,
  result,
  busy,
  error,
  aiMode,
  hasTranscript,
  selectedIds,
  scopedRangeLabel,
  onSettingsChange,
  onFind,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onCreateMarkers,
  onExportJson,
  onExportCsv,
  onCopyTitle,
  onCopyHook,
  onCopyNotes,
  onSendToBrollWorkflow,
}: ShortsExtractorCardProps) {
  const candidates = result?.candidates ?? [];
  const selectedCount = candidates.filter((candidate) => selectedIds.has(candidate.id)).length;

  return (
    <div className="rounded-3xl border border-border/70 bg-background/60 p-4">
      <CardHeader
        eyebrow="Long to Shorts"
        title="Shorts Extractor"
        description="Score long-form transcript moments, export candidate briefs, and create Premiere span markers."
        action={
          <div className="flex flex-wrap gap-2">
            <StatusPill tone={candidates.length > 0 ? "success" : "info"} label={`${candidates.length} candidates`} />
            <StatusPill tone={result?.providerUsed === "heuristic" ? "warning" : "info"} label={result?.providerUsed ?? "ready"} />
          </div>
        }
      />

      <details className="mt-4 rounded-2xl border border-border/70 bg-card/60 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">Settings</summary>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <DirectionSelect
            label="Duration"
            value={String(settings.desiredDurationSec) as "30" | "45" | "60" | "90"}
            options={durationOptions}
            onChange={(value) => onSettingsChange({ ...settings, desiredDurationSec: Number(value) as ShortExtractionSettings["desiredDurationSec"] })}
          />
          <DirectionSelect
            label="Clip count"
            value={String(settings.clipCount) as "1" | "3" | "5" | "10"}
            options={countOptions}
            onChange={(value) => onSettingsChange({ ...settings, clipCount: Number(value) as ShortExtractionSettings["clipCount"] })}
          />
          <DirectionSelect
            label="Platform"
            value={settings.platform}
            options={platformOptions}
            onChange={(value) => onSettingsChange({ ...settings, platform: value })}
          />
          <DirectionSelect
            label="Goal"
            value={settings.clipGoal}
            options={goalOptions}
            onChange={(value) => onSettingsChange({ ...settings, clipGoal: value })}
          />
          <DirectionSelect
            label="Hook"
            value={settings.hookStyle}
            options={hookOptions}
            onChange={(value) => onSettingsChange({ ...settings, hookStyle: value })}
          />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Toggle label="Allow overrun" checked={settings.allowOverrun} onChange={(value) => onSettingsChange({ ...settings, allowOverrun: value })} />
          <Toggle label="Include CTA ending" checked={settings.includeCtaEnding} onChange={(value) => onSettingsChange({ ...settings, includeCtaEnding: value })} />
          <Toggle label="Avoid duplicate topics" checked={settings.avoidDuplicateTopics} onChange={(value) => onSettingsChange({ ...settings, avoidDuplicateTopics: value })} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Slider
            label="Minimum hook score"
            value={settings.minHookScore}
            onChange={(value) => onSettingsChange({ ...settings, minHookScore: value })}
          />
          <Slider
            label="Minimum completeness"
            value={settings.minCompletenessScore}
            onChange={(value) => onSettingsChange({ ...settings, minCompletenessScore: value })}
          />
        </div>
      </details>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onFind()}
          disabled={busy || !hasTranscript}
          className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Finding shorts" : "Find best shorts"}
        </button>
        <button
          type="button"
          disabled
          title="Available in Phase 17 - sequence duplication API pending host work."
          className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium opacity-50"
        >
          Create separate sequence
        </button>
        <button
          type="button"
          disabled
          title="Available in Phase 17 - sequence In/Out API pending host work."
          className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium opacity-50"
        >
          Add to work area
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {!hasTranscript ? <InlineMessage tone="warning" message="Load Premiere markers or a timestamped transcript before extracting shorts." /> : null}
        {error ? <InlineMessage tone="error" message={error} /> : null}
        {result?.providerUsed === "heuristic" && aiMode === "off" ? (
          <InlineMessage tone="warning" message="Using heuristic extraction. Run Check Providers and switch AI on for AI-ranked copy and scores." />
        ) : null}
        {scopedRangeLabel ? <InlineMessage tone="info" message={`B-roll workflow scoped to ${scopedRangeLabel}.`} /> : null}
        {result && candidates.length === 0 ? <InlineMessage tone="neutral" message="No candidates met the thresholds. Lower the minimum scores or allow a wider duration range." /> : null}
        {result?.errors.length ? <InlineMessage tone="warning" message={`AI fallback notes: ${result.errors.slice(0, 2).join(" | ")}`} /> : null}
      </div>

      {selectedCount > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-sky-500/30 bg-sky-500/10 p-3">
          <StatusPill tone="info" label={`${selectedCount} selected`} />
          <button type="button" onClick={() => void onCreateMarkers()} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
            Create Premiere markers
          </button>
          <button type="button" onClick={onExportJson} className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium hover:bg-accent">
            Export JSON
          </button>
          <button type="button" onClick={onExportCsv} className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium hover:bg-accent">
            Export CSV
          </button>
          <button type="button" onClick={onClearSelection} className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium hover:bg-accent">
            Clear
          </button>
        </div>
      ) : candidates.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={onSelectAll} className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium hover:bg-accent">
            Select all
          </button>
          <button type="button" onClick={onExportJson} className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium hover:bg-accent">
            Export JSON
          </button>
          <button type="button" onClick={onExportCsv} className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium hover:bg-accent">
            Export CSV
          </button>
        </div>
      ) : null}

      <div className="mt-4 max-h-[520px] space-y-3 overflow-auto">
        {candidates.map((candidate) => (
          <ShortCandidateRow
            key={candidate.id}
            candidate={candidate}
            selected={selectedIds.has(candidate.id)}
            onToggleSelect={() => onToggleSelect(candidate.id)}
            onCopyTitle={() => void onCopyTitle(candidate)}
            onCopyHook={() => void onCopyHook(candidate)}
            onCopyNotes={() => void onCopyNotes(candidate)}
            onSendToBrollWorkflow={() => onSendToBrollWorkflow(candidate)}
          />
        ))}
      </div>
    </div>
  );
}

function ShortCandidateRow({
  candidate,
  selected,
  onToggleSelect,
  onCopyTitle,
  onCopyHook,
  onCopyNotes,
  onSendToBrollWorkflow,
}: {
  candidate: ShortCandidate;
  selected: boolean;
  onToggleSelect: () => void;
  onCopyTitle: () => void;
  onCopyHook: () => void;
  onCopyNotes: () => void;
  onSendToBrollWorkflow: () => void;
}) {
  return (
    <article className="rounded-2xl border border-border/70 bg-card/60 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label className="flex min-w-0 flex-1 items-start gap-3">
          <input type="checkbox" checked={selected} onChange={onToggleSelect} className="mt-1" />
          <span className="min-w-0">
            <span className="block font-semibold text-foreground">{candidate.titleSuggestion}</span>
            <span className="mt-1 block leading-6 text-muted-foreground">{candidate.hookLine}</span>
          </span>
        </label>
        <span className="font-mono text-xs text-muted-foreground">
          {formatSeconds(candidate.startSec)} - {formatSeconds(candidate.endSec)} ({Math.round(candidate.durationSec)}s)
        </span>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        <SummaryRow label="Overall" value={`${Math.round(candidate.scores.overall * 100)}%`} />
        <SummaryRow label="Goal" value={candidate.clipGoal} />
        <SummaryRow label="CTA" value={candidate.hasCtaOpportunity ? "yes" : "optional"} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <ScorePill label="Hook" value={candidate.scores.hook} />
        <ScorePill label="Retention" value={candidate.scores.retention} />
        <ScorePill label="Complete" value={candidate.scores.completeness} />
        <ScorePill label="Edge" value={candidate.scores.controversy} />
        <ScorePill label="Clarity" value={candidate.scores.clarity} />
      </div>
      <p className="mt-3 text-xs leading-5 text-amber-300">{candidate.reasonSelected}</p>
      {candidate.warnings.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {candidate.warnings.map((warning) => <StatusPill key={warning} tone="warning" label={warning} />)}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onCopyTitle} className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent">
          Copy title
        </button>
        <button type="button" onClick={onCopyHook} className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent">
          Copy hook
        </button>
        <button type="button" onClick={onCopyNotes} className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent">
          Copy notes
        </button>
        <button type="button" onClick={onSendToBrollWorkflow} className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent">
          Send to B-roll workflow
        </button>
      </div>
    </article>
  );
}

function ScorePill({ label, value }: { label: string; value: number }) {
  const tone = value >= 0.7 ? "success" : value >= 0.45 ? "info" : "warning";
  return <StatusPill tone={tone} label={`${label} ${Math.round(value * 100)}%`} />;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/50 px-3 py-2 text-sm">
      <span className="font-medium">{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="flex justify-between gap-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
        <span>{label}</span>
        <span>{Math.round(value * 100)}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
