import type { ImportedGeneratedAsset, MissingAssetPrompt } from "./types";

export interface AssetAttachDraft {
  filePath: string;
  sourceTool: string;
  notes: string;
}

export interface GeneratedAssetDurationMetadata {
  sourceDurationSec?: number;
  durationProbeStatus?: "not_probed" | "available" | "failed" | "unavailable";
  durationProbeNote?: string;
}

export function createImportedGeneratedAsset(
  prompt: MissingAssetPrompt,
  draft: AssetAttachDraft,
  durationMetadata: GeneratedAssetDurationMetadata = {},
): ImportedGeneratedAsset {
  const filePath = draft.filePath.trim();
  const importedAt = new Date().toISOString();

  return {
    id: `asset-${prompt.id}-${hashString(`${filePath}-${importedAt}`)}`,
    filePath,
    fileName: getFileName(filePath),
    fileType: inferGeneratedAssetFileType(filePath),
    linkedPromptId: prompt.id,
    linkedPlacementId: prompt.placementId,
    linkedSegmentId: prompt.segmentId,
    timestampStartSec: prompt.startSec,
    timestampEndSec: prompt.endSec,
    sourceTool: draft.sourceTool.trim() || "Manual",
    status: "imported",
    notes: draft.notes.trim(),
    importedAt,
    intendedUsage: prompt.usage,
    requestedAssetType: prompt.suggestedAssetType,
    replaceOrEnhance: prompt.usage,
    sourceDurationSec: durationMetadata.sourceDurationSec,
    durationProbeStatus: durationMetadata.durationProbeStatus ?? "not_probed",
    durationProbeNote: durationMetadata.durationProbeNote,
    analysisStatus: "not_analyzed",
    analysisNote: "Visual analysis has not been run yet.",
  };
}

export function inferGeneratedAssetFileType(
  filePath: string,
): ImportedGeneratedAsset["fileType"] {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "webp", "tif", "tiff", "gif", "bmp"].includes(ext)) {
    return "image";
  }
  if (["mp4", "mov", "m4v", "avi", "mkv", "webm"].includes(ext)) {
    return "video";
  }
  if (["wav", "mp3", "aif", "aiff", "m4a", "flac"].includes(ext)) {
    return "audio";
  }
  if (["exr", "psd"].includes(ext) || filePath.toLowerCase().includes("alpha")) {
    return "alpha";
  }
  return "other";
}

export function formatAssetInboxCsv(assets: ImportedGeneratedAsset[]): string {
  const rows = [
    [
      "id",
      "fileName",
      "filePath",
      "fileType",
      "status",
      "sourceTool",
      "linkedPromptId",
      "linkedPlacementId",
      "startSec",
      "endSec",
      "intendedUsage",
      "requestedAssetType",
      "sourceDurationSec",
      "durationProbeStatus",
      "durationProbeNote",
      "analysisStatus",
      "analysisProvider",
      "visualSummary",
      "visualKeywords",
      "visualStyle",
      "moodTags",
      "likelyUseCases",
      "editorialRoleFit",
      "matchKind",
      "analysisNote",
      "notes",
    ],
    ...assets.map((asset) => [
      asset.id,
      asset.fileName,
      asset.filePath,
      asset.fileType,
      asset.status,
      asset.sourceTool,
      asset.linkedPromptId,
      asset.linkedPlacementId,
      asset.timestampStartSec.toFixed(2),
      asset.timestampEndSec.toFixed(2),
      asset.intendedUsage,
      asset.requestedAssetType,
      asset.sourceDurationSec?.toFixed(2) ?? "",
      asset.durationProbeStatus ?? "not_probed",
      asset.durationProbeNote ?? "",
      asset.analysisStatus ?? "not_analyzed",
      asset.analysisProvider ?? "",
      asset.visualSummary ?? "",
      asset.visualKeywords?.join("; ") ?? "",
      asset.visualStyle?.join("; ") ?? "",
      asset.moodTags?.join("; ") ?? "",
      asset.likelyUseCases?.join("; ") ?? "",
      asset.editorialRoleFit?.join("; ") ?? "",
      asset.matchKind ?? "",
      asset.analysisNote ?? "",
      asset.notes,
    ]),
  ];

  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
}

function escapeCsvCell(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
