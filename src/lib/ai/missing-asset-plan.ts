import type { TimelinePlacement } from "../timeline-plan";
import type {
  DynamicEditorSettings,
  MissingAssetPlan,
  MissingAssetPrompt,
  MissingAssetToolCategory,
  MissingAssetType,
  ScriptBeat,
} from "./types";

export function buildMissingAssetPlan(
  placements: TimelinePlacement[],
  settings: DynamicEditorSettings,
): MissingAssetPlan {
  const prompts = placements
    .filter((placement) => shouldCreatePrompt(placement, settings))
    .map((placement) => createPromptItem(placement, settings));

  return {
    prompts,
    highPriorityCount: prompts.filter((prompt) => prompt.priority === "high").length,
    byType: prompts.reduce<Record<MissingAssetType, number>>(
      (summary, prompt) => ({
        ...summary,
        [prompt.suggestedAssetType]: (summary[prompt.suggestedAssetType] ?? 0) + 1,
      }),
      {
        image: 0,
        video: 0,
        background: 0,
        overlay: 0,
        texture: 0,
        thumbnail: 0,
        music: 0,
        sfx: 0,
        rotoscope: 0,
      },
    ),
    generatedAt: new Date().toISOString(),
  };
}

export function formatMissingAssetPrompt(prompt: MissingAssetPrompt): string {
  return [
    `# ${prompt.priority.toUpperCase()} - ${prompt.suggestedAssetType} - ${prompt.startSec.toFixed(2)}s to ${prompt.endSec.toFixed(2)}s`,
    `Segment: ${prompt.transcriptText}`,
    `Role: ${prompt.editorialRole}`,
    `Need: ${prompt.reason}`,
    `Use: ${prompt.usage}`,
    `Tool: ${prompt.suggestedToolCategory}`,
    "",
    "Prompt:",
    prompt.promptText,
    prompt.negativePrompt ? `\nAvoid:\n${prompt.negativePrompt}` : "",
    `\nStyle notes:\n${prompt.styleNotes}`,
    prompt.ctaContext ? `\nCTA context:\n${prompt.ctaContext}` : "",
    prompt.brandNotes ? `\nBrand notes:\n${prompt.brandNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatMissingAssetPlanMarkdown(plan: MissingAssetPlan): string {
  if (plan.prompts.length === 0) {
    return "# Missing Asset Plan\n\nNo missing assets were recommended for this preview.";
  }

  return [
    "# Missing Asset Plan",
    "",
    `Prompts: ${plan.prompts.length}`,
    `High priority: ${plan.highPriorityCount}`,
    "",
    ...plan.prompts.map(formatMissingAssetPrompt),
  ].join("\n\n---\n\n");
}

function shouldCreatePrompt(placement: TimelinePlacement, settings: DynamicEditorSettings): boolean {
  if (placement.strategy === "manual" && !placement.lowConfidence) {
    return false;
  }

  const brollStyle = settings.brollStyle?.toLowerCase() ?? "";
  const generatedReady = brollStyle.includes("generated");
  const minimalFaceTime = brollStyle.includes("minimal");
  const importantRole = placement.editorialRole === "hook" || placement.editorialRole === "cta";
  const weakAi = placement.lowConfidence || placement.strategy === "fallback";
  const blank = placement.strategy === "blank" || !placement.mediaPath;

  if (minimalFaceTime) {
    return blank || (importantRole && weakAi);
  }

  if (blank || weakAi) {
    return true;
  }

  return generatedReady && importantRole && placement.aiConfidence < 0.72;
}

function createPromptItem(
  placement: TimelinePlacement,
  settings: DynamicEditorSettings,
): MissingAssetPrompt {
  const visualIntent = inferVisualIntent(placement.text, settings);
  const visualMode = inferVisualMode(placement.text, placement.editorialRole, settings);
  const suggestedAssetType = chooseAssetType(placement, visualMode, settings);
  const suggestedToolCategory = chooseToolCategory(suggestedAssetType);
  const reason = buildReason(placement, settings);
  const styleNotes = buildStyleNotes(settings, visualMode);
  const priority = resolvePriority(placement, settings);
  const usage = placement.strategy === "blank" || !placement.mediaPath
    ? "replace blank"
    : placement.lowConfidence || placement.strategy === "fallback"
      ? "replace fallback"
      : "enhance existing media";

  return {
    id: `missing-${placement.id}`,
    segmentId: placement.segmentId,
    placementId: placement.id,
    startSec: placement.startSec,
    endSec: placement.endSec,
    transcriptText: placement.text,
    editorialRole: placement.editorialRole,
    visualIntent,
    visualMode,
    reason,
    suggestedAssetType,
    suggestedToolCategory,
    promptText: buildPromptText(placement, settings, visualIntent, visualMode, suggestedAssetType),
    negativePrompt: buildNegativePrompt(settings),
    styleNotes,
    ctaContext: settings.ctaContext || undefined,
    brandNotes: settings.brandNotes || undefined,
    priority,
    status: "draft",
    usage,
  };
}

function inferVisualIntent(text: string, settings: DynamicEditorSettings): string {
  const lowered = text.toLowerCase();
  if (/\b(money|sales|revenue|profit|income|payment|cash)\b/.test(lowered)) {
    return "premium business outcome visual: revenue dashboard, client result, clean laptop workflow, payment confirmation";
  }
  if (/\b(travel|airport|cafe|hotel|remote|freedom)\b/.test(lowered)) {
    return "location-freedom visual: laptop in cafe, airport transition, remote work with premium travel context";
  }
  if (/\b(client|lead|webinar|training|quiz|book|call)\b/.test(lowered)) {
    return "conversion visual: booking calendar, webinar/training page, CRM lead flow, client call proof";
  }
  if (/\b(step|process|system|framework|tutorial|learn)\b/.test(lowered)) {
    return "education support visual: clean checklist, screen recording style, framework board, process diagram";
  }
  if (settings.editGoal?.toLowerCase().includes("authority")) {
    return "authority visual: confident founder, polished workspace, client proof, premium talking-head support";
  }
  return "specific B-roll that supports the spoken idea without generic filler";
}

function inferVisualMode(
  text: string,
  role: TimelinePlacement["editorialRole"],
  settings: DynamicEditorSettings,
): ScriptBeat["visualMode"] {
  const brollStyle = settings.brollStyle?.toLowerCase() ?? "";
  const lowered = text.toLowerCase();
  if (brollStyle.includes("minimal")) {
    return "face-time";
  }
  if (brollStyle.includes("metaphorical") || /\b(freedom|stuck|pressure|dream|identity)\b/.test(lowered)) {
    return "metaphorical";
  }
  if (role === "transition" || settings.editStyle?.toLowerCase().includes("luxury")) {
    return "style";
  }
  return "literal";
}

function chooseAssetType(
  placement: TimelinePlacement,
  visualMode: ScriptBeat["visualMode"],
  settings: DynamicEditorSettings,
): MissingAssetType {
  const style = settings.editStyle?.toLowerCase() ?? "";
  const broll = settings.brollStyle?.toLowerCase() ?? "";
  if (visualMode === "face-time") {
    return "overlay";
  }
  if (placement.editorialRole === "cta") {
    return "overlay";
  }
  if (visualMode === "style" && style.includes("luxury")) {
    return "background";
  }
  if (broll.includes("stock") || style.includes("fast") || style.includes("high-energy")) {
    return "video";
  }
  if (broll.includes("generated")) {
    return /\b(move|travel|scroll|dashboard|walk|call)\b/i.test(placement.text) ? "video" : "image";
  }
  return "image";
}

function chooseToolCategory(assetType: MissingAssetType): MissingAssetToolCategory {
  if (assetType === "music") {
    return "music generator";
  }
  if (assetType === "sfx") {
    return "SFX library";
  }
  if (assetType === "rotoscope") {
    return "rotoscope tool";
  }
  return assetType === "video" ? "video generator" : "image generator";
}

function buildReason(placement: TimelinePlacement, settings: DynamicEditorSettings): string {
  if (placement.strategy === "blank" || !placement.mediaPath) {
    return placement.editorialRole === "hook" || placement.editorialRole === "cta"
      ? "Important segment is blank, so a purpose-built visual would protect retention."
      : "No local media was selected for this transcript moment.";
  }
  if (placement.lowConfidence) {
    return placement.fallbackReason ?? "Selected local media is below the confidence threshold.";
  }
  if (settings.brollStyle?.toLowerCase().includes("generated")) {
    return "Generated Asset Ready is active and this important moment could be strengthened with a custom asset.";
  }
  return "A custom visual would improve clarity or retention.";
}

function buildPromptText(
  placement: TimelinePlacement,
  settings: DynamicEditorSettings,
  visualIntent: string,
  visualMode: ScriptBeat["visualMode"],
  assetType: MissingAssetType,
): string {
  const style = settings.editStyle ?? "Premium Business";
  const broll = settings.brollStyle ?? "Mixed";
  const caption = settings.captionStyle ?? "Clean Bold";
  const direction = settings.creativeDirection ? ` Creative direction: ${settings.creativeDirection}` : "";
  const cta = settings.ctaContext && placement.editorialRole === "cta" ? ` Include space for CTA context: ${settings.ctaContext}.` : "";

  return [
    `Create a ${assetType} asset for a ${style} short-form edit.`,
    `Transcript moment: "${placement.text}"`,
    `Editorial role: ${placement.editorialRole}. Visual mode: ${visualMode}. Visual intent: ${visualIntent}.`,
    `B-roll style: ${broll}. Caption style context: ${caption}.`,
    "Make it specific, modern, realistic, and useful for a professional editor.",
    direction,
    cta,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildNegativePrompt(settings: DynamicEditorSettings): string {
  const style = settings.editStyle?.toLowerCase() ?? "";
  const avoid = [
    "generic stock-photo cliches",
    "messy composition",
    "fake text overlays",
    "watermarks",
    "unreadable UI",
  ];
  if (style.includes("premium") || style.includes("luxury")) {
    avoid.push("cheap money graphics", "cartoon icons", "overly saturated colors", "cheesy cash piles");
  }
  if (settings.brandNotes?.toLowerCase().includes("no emojis")) {
    avoid.push("emoji graphics");
  }
  return avoid.join(", ");
}

function buildStyleNotes(settings: DynamicEditorSettings, visualMode: ScriptBeat["visualMode"]): string {
  return [
    settings.editGoal ? `Goal: ${settings.editGoal}` : "",
    settings.editStyle ? `Style: ${settings.editStyle}` : "",
    settings.brollStyle ? `B-roll: ${settings.brollStyle}` : "",
    settings.captionStyle ? `Captions: ${settings.captionStyle}` : "",
    `Visual mode: ${visualMode}`,
    settings.brandNotes ? `Brand: ${settings.brandNotes}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

function resolvePriority(
  placement: TimelinePlacement,
  settings: DynamicEditorSettings,
): MissingAssetPrompt["priority"] {
  if (placement.editorialRole === "hook" || placement.editorialRole === "cta") {
    return "high";
  }
  if (placement.strategy === "blank" || placement.lowConfidence || settings.brollStyle?.toLowerCase().includes("generated")) {
    return "medium";
  }
  return "low";
}
