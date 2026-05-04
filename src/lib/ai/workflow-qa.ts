import type {
  AgentHandoffPackage,
  GeneratedAssetRerankResult,
  ImportedGeneratedAsset,
  MissingAssetPlan,
} from "./types";
import type { TimelinePlacement } from "../timeline-plan";

export type WorkflowQaStatus = "ready" | "warning" | "missing";

export interface WorkflowQaItem {
  id: string;
  label: string;
  status: WorkflowQaStatus;
  explanation: string;
  actionHint: string;
}

export interface WorkflowQaReportInput {
  projectName?: string | null;
  sequenceName?: string | null;
  providerStatus: string;
  directorControls: {
    editGoal: string;
    editStyle: string;
    brollStyle: string;
    captionStyle: string;
    ctaContext?: string;
    creativeDirection?: string;
    brandNotes?: string;
  };
  transcriptCount: number;
  mediaCount: number;
  previewPlacements: TimelinePlacement[];
  missingAssetPlan: MissingAssetPlan;
  agentHandoffPackage: AgentHandoffPackage;
  generatedAssets: ImportedGeneratedAsset[];
  generatedAssetSuggestions: GeneratedAssetRerankResult | null;
  premiereReady: boolean;
  warnings: string[];
}

export interface WorkflowQaReport {
  createdAt: string;
  readinessStatus: WorkflowQaStatus;
  checklist: WorkflowQaItem[];
  metrics: {
    placements: number;
    lowConfidencePlacements: number;
    missingPrompts: number;
    refinedPrompts: number;
    handoffItems: number;
    importedGeneratedAssets: number;
    approvedGeneratedAssets: number;
    analyzedAssets: number;
    generatedAssetMatchSuggestions: number;
  };
  warnings: string[];
}

export function buildWorkflowQaChecklist(input: WorkflowQaReportInput): WorkflowQaItem[] {
  const refinedPromptCount = input.missingAssetPlan.prompts.filter((prompt) => prompt.aiRefined).length;
  const approvedAssetCount = input.generatedAssets.filter((asset) => asset.status === "approved").length;
  const analyzedAssetCount = input.generatedAssets.filter((asset) => asset.analysisStatus === "available").length;
  const durationProbedCount = input.generatedAssets.filter(
    (asset) => asset.fileType !== "video" || asset.durationProbeStatus === "available",
  ).length;
  const providerReady = /ready|reachable|available|ok|ollama|gemma/i.test(input.providerStatus);

  return [
    item("transcript", "Transcript loaded", input.transcriptCount > 0, "Load markers or paste timestamped transcript."),
    item("media", "Media folder scanned", input.mediaCount > 0, "Scan a local image/video folder."),
    item("provider", "AI provider available", providerReady, "Use Local Ollama/Gemma or Hybrid if model health is unavailable."),
    item("preview", "Preview plan generated", input.previewPlacements.length > 0, "Build a preview plan from transcript and media."),
    item("missing-assets", "Missing Asset Plan generated", input.missingAssetPlan.prompts.length > 0, "Weak/blank moments create prompt briefs after preview."),
    {
      id: "prompts",
      label: "Prompts refined or rule prompts available",
      status: input.missingAssetPlan.prompts.length === 0 ? "missing" : refinedPromptCount > 0 ? "ready" : "warning",
      explanation:
        refinedPromptCount > 0
          ? `${refinedPromptCount} prompts are AI-refined.`
          : input.missingAssetPlan.prompts.length > 0
            ? "Rule-generated prompts are available."
            : "No prompts are available yet.",
      actionHint: refinedPromptCount > 0 ? "Ready for handoff." : "Optional: refine prompts with AI.",
    },
    item("handoff", "Agent Handoff package exportable", input.agentHandoffPackage.items.length > 0, "Export after Missing Asset Plan exists."),
    item("result-import", "Agent Result JSON import ready", true, "Paste a valid local result contract when external generation is complete."),
    item("assets", "Generated assets attached", input.generatedAssets.length > 0, "Attach files manually or import Agent Result JSON."),
    item("duration", "Generated asset duration probed", durationProbedCount > 0, "Probe generated videos when local ffprobe is available."),
    item("analysis", "Generated asset visual analysis available", analyzedAssetCount > 0, "Analyze approved image/video assets."),
    item("rerank", "Approved assets applied/reranked", approvedAssetCount > 0 && Boolean(input.generatedAssetSuggestions?.suggestions.length), "Run generated asset suggestions after approval/analysis."),
    item("premiere", "Premiere execution ready", input.premiereReady, "Resolve preview warnings before placing on timeline."),
  ];
}

export function buildWorkflowQaReport(input: WorkflowQaReportInput): WorkflowQaReport {
  const checklist = buildWorkflowQaChecklist(input);
  const readinessStatus = checklist.some((item) => item.status === "missing")
    ? "missing"
    : checklist.some((item) => item.status === "warning")
      ? "warning"
      : "ready";

  return {
    createdAt: new Date().toISOString(),
    readinessStatus,
    checklist,
    metrics: {
      placements: input.previewPlacements.length,
      lowConfidencePlacements: input.previewPlacements.filter((placement) => placement.lowConfidence).length,
      missingPrompts: input.missingAssetPlan.prompts.length,
      refinedPrompts: input.missingAssetPlan.prompts.filter((prompt) => prompt.aiRefined).length,
      handoffItems: input.agentHandoffPackage.items.length,
      importedGeneratedAssets: input.generatedAssets.length,
      approvedGeneratedAssets: input.generatedAssets.filter((asset) => asset.status === "approved").length,
      analyzedAssets: input.generatedAssets.filter((asset) => asset.analysisStatus === "available").length,
      generatedAssetMatchSuggestions: input.generatedAssetSuggestions?.suggestions.length ?? 0,
    },
    warnings: input.warnings,
  };
}

export function exportWorkflowQaMarkdown(report: WorkflowQaReport, input: WorkflowQaReportInput): string {
  return [
    "# WeaveEdit Workflow QA Report",
    "",
    `Created: ${report.createdAt}`,
    `Readiness: ${report.readinessStatus}`,
    `Project: ${input.projectName || "Not connected"}`,
    `Sequence: ${input.sequenceName || "Open a sequence"}`,
    `Provider: ${input.providerStatus}`,
    "",
    "## Director Controls",
    "",
    `- Goal: ${input.directorControls.editGoal}`,
    `- Style: ${input.directorControls.editStyle}`,
    `- B-roll: ${input.directorControls.brollStyle}`,
    `- Captions: ${input.directorControls.captionStyle}`,
    input.directorControls.ctaContext ? `- CTA: ${input.directorControls.ctaContext}` : "",
    input.directorControls.creativeDirection ? `- Direction: ${input.directorControls.creativeDirection}` : "",
    input.directorControls.brandNotes ? `- Brand notes: ${input.directorControls.brandNotes}` : "",
    "",
    "## Metrics",
    "",
    ...Object.entries(report.metrics).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Checklist",
    "",
    ...report.checklist.map((item) => `- ${item.status.toUpperCase()} - ${item.label}: ${item.explanation} Hint: ${item.actionHint}`),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length ? report.warnings.map((warning) => `- ${warning}`) : ["- None"]),
    "",
  ].filter((line) => line !== "").join("\n");
}

export function buildDemoAgentResultJson(pkg: AgentHandoffPackage, limit = 3): string {
  return JSON.stringify(
    {
      packageVersion: "1.0",
      results: pkg.items.slice(0, limit).map((item, index) => ({
        promptId: item.promptId,
        placementId: item.placementId,
        filePath: `D:/WeaveEdit-Demo-PLACEHOLDER/not-real-demo-asset-${index + 1}.${item.assetType === "video" ? "mp4" : "png"}`,
        sourceTool: "DEMO PLACEHOLDER - not generated",
        assetType: item.assetType === "video" ? "video" : "image",
        status: "completed",
        notes: "Demo placeholder only. Replace this path with a real generated local file before applying to Premiere.",
        durationSec: item.durationSuggestionSec,
        error: null,
      })),
    },
    null,
    2,
  );
}

function item(id: string, label: string, ready: boolean, actionHint: string): WorkflowQaItem {
  return {
    id,
    label,
    status: ready ? "ready" : "missing",
    explanation: ready ? "Ready." : "Missing.",
    actionHint,
  };
}
