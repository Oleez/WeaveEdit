import { getFileName, normalizePath } from "../media";
import { createFallbackAssetProfile } from "./dynamic-editor";
import { profileAssetsWithAi } from "./router";
import { hydrateAiCandidates } from "./video-preprocessing";
import type {
  AiAssetCandidate,
  AiMode,
  AiScoringContext,
  AssetSemanticProfile,
  ImportedGeneratedAsset,
} from "./types";

export interface GeneratedAssetAnalysisResult {
  asset: ImportedGeneratedAsset;
  warnings: string[];
}

export async function analyzeImportedGeneratedAsset(
  asset: ImportedGeneratedAsset,
  mode: AiMode,
  context: AiScoringContext,
  force = false,
): Promise<GeneratedAssetAnalysisResult> {
  if (!force && asset.analysisStatus === "available") {
    return { asset, warnings: [] };
  }

  if (asset.fileType !== "image" && asset.fileType !== "video") {
    return {
      asset: {
        ...asset,
        analysisStatus: "unavailable",
        analysisNote: "Visual analysis is only available for generated image and video assets.",
        analyzedAt: new Date().toISOString(),
      },
      warnings: [],
    };
  }

  if (mode === "off") {
    return {
      asset: {
        ...asset,
        analysisStatus: "unavailable",
        analysisNote: "AI mode is off; visual analysis was skipped.",
        analyzedAt: new Date().toISOString(),
      },
      warnings: [],
    };
  }

  const candidate = buildGeneratedAssetCandidate(asset);

  try {
    const hydrated = await hydrateAiCandidates([candidate]);
    const hydratedCandidate = hydrated.candidates[0] ?? candidate;
    const profiled = await profileAssetsWithAi([hydratedCandidate], mode, context);
    const profile = profiled.profiles[0] ?? createFallbackAssetProfile(hydratedCandidate);
    const modelProviderUsed = profiled.providersUsed[0] ?? null;
    const warnings = [...hydrated.warnings, ...profiled.errors];

    return {
      asset: applyProfileToAsset(
        {
          ...asset,
          sourceDurationSec: asset.sourceDurationSec ?? hydratedCandidate.durationSec,
          durationProbeStatus:
            asset.durationProbeStatus ??
            (hydratedCandidate.durationSec ? "available" : asset.fileType === "video" ? "unavailable" : "not_probed"),
          durationProbeNote:
            asset.durationProbeNote ??
            (hydratedCandidate.durationSec
              ? `Detected generated video duration: ${hydratedCandidate.durationSec.toFixed(2)} seconds.`
              : asset.durationProbeNote),
        },
        profile,
        modelProviderUsed,
        warnings,
      ),
      warnings,
    };
  } catch (error) {
    const fallbackProfile = createFallbackAssetProfile(candidate);
    const fallbackAsset = applyProfileToAsset(asset, fallbackProfile, null, [String(error)]);
    return {
      asset: {
        ...fallbackAsset,
        analysisStatus: "failed",
        analysisNote: `Visual analysis failed; filename metadata was kept. ${String(error)}`,
      },
      warnings: [String(error)],
    };
  }
}

function buildGeneratedAssetCandidate(asset: ImportedGeneratedAsset): AiAssetCandidate {
  const mediaType = asset.fileType === "video" ? "video" : "image";
  const descriptor = [
    `Generated asset linked to prompt ${asset.linkedPromptId}.`,
    `Requested asset type: ${asset.requestedAssetType}.`,
    `Intended usage: ${asset.intendedUsage}.`,
    asset.sourceTool ? `Source tool/provider: ${asset.sourceTool}.` : "",
    asset.notes ? `Manual notes: ${asset.notes}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: asset.id,
    path: asset.filePath,
    name: asset.fileName || getFileName(asset.filePath),
    mediaType,
    descriptor,
    durationSec: asset.sourceDurationSec,
    folderKeywords: buildFolderKeywords(asset.filePath),
    visualPaths: mediaType === "image" ? [asset.filePath] : undefined,
  };
}

function applyProfileToAsset(
  asset: ImportedGeneratedAsset,
  profile: AssetSemanticProfile,
  modelProviderUsed: string | null,
  warnings: string[],
): ImportedGeneratedAsset {
  const modelBacked = Boolean(modelProviderUsed);
  return {
    ...asset,
    visualSummary: profile.caption,
    visualKeywords: profile.tags,
    visualStyle: [profile.visualStyle, profile.shotScale, profile.motionEnergy].filter(isStringValue),
    moodTags: profile.moodTags,
    likelyUseCases: profile.useCases,
    editorialRoleFit: profile.roleTags,
    matchKind: profile.visualStyle,
    analysisStatus: modelBacked ? "available" : warnings.length > 0 ? "failed" : "unavailable",
    analysisProvider: modelProviderUsed ?? profile.provider,
    analysisNote: modelBacked
      ? buildAnalysisNote(asset, profile.provider, warnings)
      : warnings.length > 0
        ? `AI visual analysis failed; kept filename/frame metadata fallback. ${warnings.slice(0, 1).join(" ")}`
        : "No AI visual provider returned a profile; kept metadata fallback.",
    analyzedAt: new Date().toISOString(),
  };
}

function buildAnalysisNote(
  asset: ImportedGeneratedAsset,
  provider: string,
  warnings: string[],
): string {
  const mediaNote =
    asset.fileType === "video"
      ? "Video profile used representative frames when ffmpeg could extract them."
      : "Image profile used the imported asset file when CEP file access was available.";
  const warningNote = warnings.length ? ` Warnings: ${warnings.slice(0, 2).join(" | ")}` : "";
  return `${mediaNote} Provider: ${provider}.${warningNote}`;
}

function buildFolderKeywords(filePath: string): string[] {
  const normalized = normalizePath(filePath);
  return normalized
    .split("/")
    .slice(-4, -1)
    .flatMap((part) => part.toLowerCase().split(/[^a-z0-9]+/))
    .map((token) => token.trim())
    .filter((token, index, tokens) => token.length > 2 && tokens.indexOf(token) === index)
    .slice(0, 16);
}

function isStringValue(value: string | undefined): value is string {
  return Boolean(value && value !== "unknown");
}
