export type MediaType = "image" | "video";
export type MediaLibraryMode = "images" | "videos" | "mixed";

export interface MediaLibraryItem {
  path: string;
  name: string;
  type: MediaType;
  extension: string;
}

export const IMAGE_EXTENSIONS = new Set([
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
]);

export const VIDEO_EXTENSIONS = new Set([
  ".avi",
  ".mkv",
  ".mov",
  ".mp4",
  ".mxf",
  ".webm",
]);

export function normalizePath(filePath: string): string {
  return String(filePath || "").replace(/\\/g, "/");
}

export function getFileName(filePath: string): string {
  const normalized = normalizePath(filePath);
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? filePath;
}

export function getExtension(filePath: string): string {
  const normalized = getFileName(filePath).toLowerCase();
  const dotIndex = normalized.lastIndexOf(".");
  return dotIndex >= 0 ? normalized.slice(dotIndex) : "";
}

export function getMediaTypeFromPath(filePath: string): MediaType | null {
  const extension = getExtension(filePath);

  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }

  return null;
}

export function isSupportedMediaPath(filePath: string, mode: MediaLibraryMode = "mixed"): boolean {
  const mediaType = getMediaTypeFromPath(filePath);

  if (!mediaType) {
    return false;
  }

  if (mode === "mixed") {
    return true;
  }

  return mode === "images" ? mediaType === "image" : mediaType === "video";
}

export function createMediaLibraryItem(filePath: string): MediaLibraryItem | null {
  const normalizedPath = normalizePath(filePath);
  const type = getMediaTypeFromPath(normalizedPath);

  if (!type) {
    return null;
  }

  return {
    path: normalizedPath,
    name: getFileName(normalizedPath),
    type,
    extension: getExtension(normalizedPath),
  };
}
