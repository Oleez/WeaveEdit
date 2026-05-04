import type { TimelinePlacement } from "../timeline-plan";
import type { ImportedGeneratedAsset } from "./types";

export interface GeneratedAssetApplySummary {
  updatedCount: number;
  skippedCount: number;
  skippedReasons: string[];
}

export interface GeneratedAssetApplyResult {
  placements: TimelinePlacement[];
  summary: GeneratedAssetApplySummary;
}

export type AppliedGeneratedAssetMap = Record<string, string>;

interface ApplyInput {
  placements: TimelinePlacement[];
  assets: ImportedGeneratedAsset[];
  appliedAssetIdsByPlacementId: AppliedGeneratedAssetMap;
  fileExists?: (filePath: string) => boolean | null;
  promptRecommendedPlacementIds?: Set<string>;
}

export function applyGeneratedAssetsToPlacements(input: ApplyInput): GeneratedAssetApplyResult {
  const assetsById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const skippedReasons: string[] = [];
  let updatedCount = 0;

  const placements = input.placements.map((placement) => {
    const assetId = input.appliedAssetIdsByPlacementId[placement.id];
    if (!assetId) {
      return placement;
    }

    const asset = assetsById.get(assetId);
    const skipReason = getSkipReason(placement, asset, input.fileExists, input.promptRecommendedPlacementIds);
    if (skipReason) {
      skippedReasons.push(`${placement.id}: ${skipReason}`);
      return placement;
    }

    updatedCount += 1;
    return applyAssetToPlacement(placement, asset as ImportedGeneratedAsset);
  });

  return {
    placements,
    summary: {
      updatedCount,
      skippedCount: skippedReasons.length,
      skippedReasons,
    },
  };
}

export function buildApprovedGeneratedAssetMap(
  placements: TimelinePlacement[],
  assets: ImportedGeneratedAsset[],
  fileExists?: (filePath: string) => boolean | null,
  promptRecommendedPlacementIds?: Set<string>,
): { appliedAssetIdsByPlacementId: AppliedGeneratedAssetMap; summary: GeneratedAssetApplySummary } {
  const placementById = new Map(placements.map((placement) => [placement.id, placement]));
  const selected: AppliedGeneratedAssetMap = {};
  const skippedReasons: string[] = [];

  assets
    .filter((asset) => asset.status === "approved")
    .forEach((asset) => {
      const placement = placementById.get(asset.linkedPlacementId);
      const skipReason = getSkipReason(placement, asset, fileExists, promptRecommendedPlacementIds);
      if (skipReason) {
        skippedReasons.push(`${asset.fileName}: ${skipReason}`);
        return;
      }

      if (!selected[asset.linkedPlacementId]) {
        selected[asset.linkedPlacementId] = asset.id;
      }
    });

  return {
    appliedAssetIdsByPlacementId: selected,
    summary: {
      updatedCount: Object.keys(selected).length,
      skippedCount: skippedReasons.length,
      skippedReasons,
    },
  };
}

export function isGeneratedAssetApplied(
  placement: TimelinePlacement,
  appliedAssetIdsByPlacementId: AppliedGeneratedAssetMap,
): boolean {
  return Boolean(appliedAssetIdsByPlacementId[placement.id]);
}

function getSkipReason(
  placement: TimelinePlacement | undefined,
  asset: ImportedGeneratedAsset | undefined,
  fileExists?: (filePath: string) => boolean | null,
  promptRecommendedPlacementIds?: Set<string>,
): string | null {
  if (!asset) {
    return "no linked asset record";
  }
  if (!placement) {
    return "no linked placement";
  }
  if (asset.status !== "approved") {
    return "asset not approved";
  }
  if (asset.fileType !== "image" && asset.fileType !== "video") {
    return `unsupported file type ${asset.fileType}`;
  }
  const exists = fileExists?.(asset.filePath);
  if (exists === false) {
    return "file missing";
  }
  if (!isPlacementEligibleForGeneratedAsset(placement, promptRecommendedPlacementIds)) {
    return "placement already has a strong match";
  }
  return null;
}

function isPlacementEligibleForGeneratedAsset(
  placement: TimelinePlacement,
  promptRecommendedPlacementIds?: Set<string>,
): boolean {
  return (
    placement.strategy === "blank" ||
    placement.strategy === "fallback" ||
    placement.lowConfidence ||
    Boolean(promptRecommendedPlacementIds?.has(placement.id)) ||
    Boolean(placement.generatedAssetId)
  );
}

function applyAssetToPlacement(
  placement: TimelinePlacement,
  asset: ImportedGeneratedAsset,
): TimelinePlacement {
  const mediaType = asset.fileType === "video" ? "video" : "image";
  const sourceTrim = resolveGeneratedSourceTrim(placement, asset, mediaType);

  return {
    ...placement,
    strategy: "generated",
    mediaPath: asset.filePath,
    mediaName: asset.fileName,
    mediaType,
    aiProvider: asset.sourceTool,
    aiConfidence: 1,
    aiRationale: "Approved generated asset linked from Missing Asset Plan.",
    aiVisualMatchReason: `Generated asset from ${asset.sourceTool} linked to prompt ${asset.linkedPromptId}.`,
    matchKind: "style",
    mediaPreference: mediaType,
    lowConfidence: false,
    fallbackReason: null,
    sourceInSec: sourceTrim.sourceInSec,
    sourceOutSec: sourceTrim.sourceOutSec,
    sourceDurationSec: sourceTrim.sourceDurationSec,
    trimApplied: sourceTrim.trimApplied,
    trimNote: sourceTrim.trimNote,
    generatedAssetId: asset.id,
    originalMediaPath: placement.originalMediaPath ?? placement.mediaPath,
    originalMediaName: placement.originalMediaName ?? placement.mediaName,
    originalMediaType: placement.originalMediaType ?? placement.mediaType,
    originalStrategy:
      placement.originalStrategy ??
      (placement.strategy === "generated" ? "fallback" : placement.strategy),
    usingGeneratedAsset: true,
    generatedAssetSource: asset.sourceTool,
    generatedAssetStatus: asset.status,
    generatedAssetRationale: "Approved generated asset linked from Missing Asset Plan.",
  };
}

function resolveGeneratedSourceTrim(
  placement: TimelinePlacement,
  asset: ImportedGeneratedAsset,
  mediaType: "image" | "video",
): {
  sourceInSec: number | null;
  sourceOutSec: number | null;
  sourceDurationSec: number | null;
  trimApplied: boolean;
  trimNote: string | null;
} {
  if (mediaType !== "video") {
    return {
      sourceInSec: null,
      sourceOutSec: null,
      sourceDurationSec: null,
      trimApplied: false,
      trimNote: null,
    };
  }

  const placementDuration = Math.max(0.1, placement.durationSec);
  const sourceDuration = asset.sourceDurationSec;

  if (!sourceDuration || !Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    return {
      sourceInSec: 0,
      sourceOutSec: round(placementDuration),
      sourceDurationSec: null,
      trimApplied: true,
      trimNote: "Generated video duration unknown; using opening trim.",
    };
  }

  if (sourceDuration <= placementDuration + 0.05) {
    return {
      sourceInSec: 0,
      sourceOutSec: round(Math.max(0.1, sourceDuration)),
      sourceDurationSec: round(sourceDuration),
      trimApplied: true,
      trimNote: "Generated video is shorter than the placement; using the available safe range.",
    };
  }

  const tailGuard = Math.min(1.25, Math.max(0.25, sourceDuration * 0.08));
  const maxStart = Math.max(0, sourceDuration - placementDuration - tailGuard);
  const roleBias =
    placement.editorialRole === "hook"
      ? 0.12
      : placement.editorialRole === "cta"
        ? 0.58
        : placement.editorialRole === "proof"
          ? 0.44
          : 0.28;
  const jitter = hashUnit(`${asset.id}|${placement.id}`) * 0.22;
  const sourceInSec = round(Math.min(maxStart, Math.max(0, maxStart * (roleBias + jitter))));
  const sourceOutSec = round(Math.min(sourceDuration, sourceInSec + placementDuration));

  return {
    sourceInSec,
    sourceOutSec,
    sourceDurationSec: round(sourceDuration),
    trimApplied: true,
    trimNote: "Generated video duration detected; using varied source range.",
  };
}

function hashUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
