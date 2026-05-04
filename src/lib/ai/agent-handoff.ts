import type {
  AgentGeneratedAssetResult,
  AgentHandoffItem,
  AgentHandoffPackage,
  ImportedGeneratedAsset,
  MissingAssetPlan,
  MissingAssetPrompt,
} from "./types";

export interface AgentHandoffBuildInput {
  missingAssetPlan: MissingAssetPlan;
  generatedAssets?: ImportedGeneratedAsset[];
  editGoal: string;
  editStyle: string;
  brollStyle: string;
  captionStyle: string;
  ctaContext?: string;
  creativeDirection?: string;
  brandNotes?: string;
  projectId?: string;
  sessionId?: string;
  outputFolderSuggestion?: string;
  highPriorityOnly?: boolean;
}

export interface ParsedAgentResult {
  packageVersion: "1.0";
  results: AgentGeneratedAssetResult[];
}

export function buildAgentHandoffPackage(input: AgentHandoffBuildInput): AgentHandoffPackage {
  const createdAt = new Date().toISOString();
  const prompts = input.highPriorityOnly
    ? input.missingAssetPlan.prompts.filter((prompt) => prompt.priority === "high")
    : input.missingAssetPlan.prompts;
  const assetsByPromptId = groupAssetsByPromptId(input.generatedAssets ?? []);

  return {
    packageVersion: "1.0",
    packageId: `weave-agent-handoff-${hashString(`${createdAt}-${prompts.map((prompt) => prompt.id).join("|")}`)}`,
    projectId: input.projectId,
    sessionId: input.sessionId,
    createdAt,
    editRecipe: {
      editGoal: input.editGoal,
      editStyle: input.editStyle,
      brollStyle: input.brollStyle,
      captionStyle: input.captionStyle,
      ctaContext: input.ctaContext,
      creativeDirection: input.creativeDirection,
      brandNotes: input.brandNotes,
    },
    safetyNotes: [
      "Do not call back into WeaveEdit or Premiere. Generate files externally and return local file paths only.",
      "Do not use copyrighted artists, famous song references, protected characters, or living-artist style names.",
      "Do not generate unsafe, irrelevant, or misleading visuals. Keep outputs practical for a professional editor.",
      "Save generated files locally and return one result object per generated asset.",
      "Preserve promptId and placementId exactly so WeaveEdit can link returned files back to the plan.",
    ],
    items: prompts.map((prompt) => buildHandoffItem(prompt, input.outputFolderSuggestion, assetsByPromptId.get(prompt.id))),
    resultContract: {
      packageVersion: "1.0",
      results: [
        {
          promptId: "prompt-id-from-items",
          placementId: "placement-id-from-items",
          filePath: "D:/GeneratedAssets/weave-edit/example-output.mp4",
          sourceTool: "Seedance",
          assetType: "video",
          status: "completed",
          notes: "Short premium business B-roll, ready for review.",
          durationSec: 6.2,
          error: null,
        },
      ],
    },
  };
}

export function exportAgentHandoffJson(pkg: AgentHandoffPackage): string {
  return JSON.stringify(pkg, null, 2);
}

export function exportAgentHandoffMarkdown(pkg: AgentHandoffPackage): string {
  const lines = [
    "# WeaveEdit Agent Handoff Package",
    "",
    `Package: ${pkg.packageId}`,
    `Created: ${pkg.createdAt}`,
    "",
    "## Edit Recipe",
    "",
    `- Goal: ${pkg.editRecipe.editGoal}`,
    `- Style: ${pkg.editRecipe.editStyle}`,
    `- B-roll: ${pkg.editRecipe.brollStyle}`,
    `- Captions: ${pkg.editRecipe.captionStyle}`,
    pkg.editRecipe.ctaContext ? `- CTA: ${pkg.editRecipe.ctaContext}` : "",
    pkg.editRecipe.creativeDirection ? `- Direction: ${pkg.editRecipe.creativeDirection}` : "",
    pkg.editRecipe.brandNotes ? `- Brand notes: ${pkg.editRecipe.brandNotes}` : "",
    "",
    "## Safety Notes",
    "",
    ...pkg.safetyNotes.map((note) => `- ${note}`),
    "",
    "## Assets To Generate",
    "",
    ...pkg.items.flatMap(formatHandoffItemMarkdown),
    "",
    "## Result Contract",
    "",
    "```json",
    JSON.stringify(pkg.resultContract, null, 2),
    "```",
    "",
  ].filter((line) => line !== "");

  return lines.join("\n");
}

export function formatAgentResultContract(): string {
  return JSON.stringify(
    {
      packageVersion: "1.0",
      results: [
        {
          promptId: "prompt-id-from-agent-handoff-item",
          placementId: "placement-id-from-agent-handoff-item",
          filePath: "D:/GeneratedAssets/weave-edit/generated-asset.mp4",
          sourceTool: "Seedance",
          assetType: "video",
          status: "completed",
          notes: "Generated file is saved locally and ready for WeaveEdit review.",
          durationSec: 6.2,
          error: null,
        },
      ],
    },
    null,
    2,
  );
}

export function parseAgentResultJson(raw: string): ParsedAgentResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON: ${String(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("Agent result must be a JSON object.");
  }
  if (parsed.packageVersion !== "1.0") {
    throw new Error("Unsupported agent result packageVersion. Expected 1.0.");
  }
  if (!Array.isArray(parsed.results)) {
    throw new Error("Agent result must include a results array.");
  }

  return {
    packageVersion: "1.0",
    results: parsed.results.map(validateAgentResult),
  };
}

function buildHandoffItem(
  prompt: MissingAssetPrompt,
  outputFolderSuggestion = "GeneratedAssets/WeaveEdit",
  linkedAssets: ImportedGeneratedAsset[] = [],
): AgentHandoffItem {
  const duration = Math.max(0.5, Math.round((prompt.endSec - prompt.startSec) * 100) / 100);

  return {
    id: `handoff-${prompt.id}`,
    promptId: prompt.id,
    placementId: prompt.placementId,
    segmentId: prompt.segmentId,
    startSec: prompt.startSec,
    endSec: prompt.endSec,
    transcriptText: prompt.transcriptText,
    priority: prompt.priority,
    assetType: prompt.suggestedAssetType,
    toolCategory: prompt.suggestedToolCategory,
    promptText: prompt.promptText,
    negativePrompt: prompt.negativePrompt,
    styleNotes: prompt.styleNotes,
    intendedUsage: prompt.usage,
    outputFolderSuggestion,
    aspectRatioSuggestion: inferAspectRatio(prompt),
    durationSuggestionSec: prompt.suggestedAssetType === "video" || prompt.suggestedAssetType === "music" || prompt.suggestedAssetType === "SFX"
      ? duration
      : undefined,
    namingConvention: buildNamingConvention(prompt),
    replaceOrEnhance: prompt.usage,
    linkedExistingAssetContext: linkedAssets.length
      ? linkedAssets.map((asset) => `${asset.fileName} (${asset.status}, ${asset.sourceTool})`)
      : undefined,
  };
}

function formatHandoffItemMarkdown(item: AgentHandoffItem): string[] {
  return [
    `### ${item.promptId}`,
    "",
    `- Placement: ${item.placementId}`,
    `- Timestamp: ${item.startSec.toFixed(2)} - ${item.endSec.toFixed(2)}`,
    `- Priority: ${item.priority}`,
    `- Asset type: ${item.assetType}`,
    `- Tool category: ${item.toolCategory}`,
    `- Usage: ${item.intendedUsage}`,
    `- Aspect ratio: ${item.aspectRatioSuggestion}`,
    item.durationSuggestionSec ? `- Duration: ${item.durationSuggestionSec.toFixed(2)}s` : "",
    `- Naming: ${item.namingConvention}`,
    "",
    `Transcript: ${item.transcriptText}`,
    "",
    `Prompt: ${item.promptText}`,
    "",
    item.negativePrompt ? `Negative prompt: ${item.negativePrompt}` : "",
    item.styleNotes ? `Style notes: ${item.styleNotes}` : "",
    "",
  ].filter((line) => line !== "");
}

function validateAgentResult(value: unknown, index: number): AgentGeneratedAssetResult {
  if (!isRecord(value)) {
    throw new Error(`Result ${index + 1} must be an object.`);
  }

  const promptId = requireString(value.promptId, `results[${index}].promptId`);
  const placementId = requireString(value.placementId, `results[${index}].placementId`);
  const filePath = requireString(value.filePath, `results[${index}].filePath`);
  const sourceTool = optionalString(value.sourceTool) || "Agent";
  const assetType = normalizeAssetType(value.assetType);
  const status = normalizeStatus(value.status);
  const durationSec = typeof value.durationSec === "number" && Number.isFinite(value.durationSec)
    ? value.durationSec
    : undefined;

  return {
    promptId,
    placementId,
    filePath,
    sourceTool,
    assetType,
    status,
    notes: optionalString(value.notes),
    durationSec,
    error: value.error === null ? null : optionalString(value.error),
  };
}

function groupAssetsByPromptId(assets: ImportedGeneratedAsset[]): Map<string, ImportedGeneratedAsset[]> {
  const grouped = new Map<string, ImportedGeneratedAsset[]>();
  assets.forEach((asset) => {
    grouped.set(asset.linkedPromptId, [...(grouped.get(asset.linkedPromptId) ?? []), asset]);
  });
  return grouped;
}

function inferAspectRatio(prompt: MissingAssetPrompt): string {
  if (prompt.suggestedAssetType === "thumbnail") {
    return "16:9 or platform-specific thumbnail";
  }
  if (prompt.suggestedAssetType === "music" || prompt.suggestedAssetType === "SFX") {
    return "audio only";
  }
  return "9:16 vertical short-form";
}

function buildNamingConvention(prompt: MissingAssetPrompt): string {
  return `${sanitizeName(prompt.priority)}-${sanitizeName(prompt.suggestedAssetType)}-${sanitizeName(prompt.placementId)}-{short-description}`;
}

function normalizeAssetType(value: unknown): AgentGeneratedAssetResult["assetType"] {
  return value === "image" || value === "video" || value === "audio" || value === "alpha" || value === "other"
    ? value
    : "other";
}

function normalizeStatus(value: unknown): AgentGeneratedAssetResult["status"] {
  return value === "completed" || value === "failed" || value === "skipped" ? value : "completed";
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sanitizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
