import { AiAssetCandidate } from "./types";
import { MediaLibraryItem, getFileName, normalizePath } from "../media";

interface NodeRequire {
  (moduleName: string): unknown;
}

interface NodeModules {
  childProcess: {
    execFileSync: (
      file: string,
      args?: string[],
      options?: { encoding?: BufferEncoding; stdio?: "pipe" | "ignore" | Array<unknown> },
    ) => string;
  };
  fs: {
    existsSync: (path: string) => boolean;
    mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
    readdirSync: (path: string) => string[];
  };
  os: {
    tmpdir: () => string;
  };
  path: {
    join: (...parts: string[]) => string;
  };
}

export interface VideoToolingStatus {
  ffmpegAvailable: boolean;
  ffprobeAvailable: boolean;
}

export interface VideoDurationProbeResult {
  sourceDurationSec?: number;
  durationProbeStatus: "not_probed" | "available" | "failed" | "unavailable";
  durationProbeNote: string;
}

export interface HydrateCandidatesResult {
  candidates: AiAssetCandidate[];
  warnings: string[];
  tooling: VideoToolingStatus;
  cacheHits: number;
}

export interface LibraryIndexResult extends HydrateCandidatesResult {
  indexedCount: number;
}

interface CachedHydration {
  candidate: AiAssetCandidate;
  warnings: string[];
}

const hydrationCache = new Map<string, CachedHydration>();
let cachedVideoBinaries: { ffmpeg: string | null; ffprobe: string | null } | null = null;

export function detectVideoTooling(): VideoToolingStatus {
  if (!isNodeEnabled()) {
    return { ffmpegAvailable: false, ffprobeAvailable: false };
  }

  const binaries = resolveVideoBinaries();

  return {
    ffmpegAvailable: Boolean(binaries.ffmpeg),
    ffprobeAvailable: Boolean(binaries.ffprobe),
  };
}

export function probeVideoDuration(filePath: string): VideoDurationProbeResult {
  if (!isNodeEnabled()) {
    return {
      durationProbeStatus: "unavailable",
      durationProbeNote: "Node/CEP file access is unavailable; duration was not probed.",
    };
  }

  const tooling = detectVideoTooling();
  if (!tooling.ffprobeAvailable) {
    return {
      durationProbeStatus: "unavailable",
      durationProbeNote: "ffprobe is unavailable; generated video duration is unknown.",
    };
  }

  try {
    const sourceDurationSec = getVideoDuration(filePath);
    return {
      sourceDurationSec,
      durationProbeStatus: "available",
      durationProbeNote: `Detected generated video duration: ${sourceDurationSec.toFixed(2)} seconds.`,
    };
  } catch (error) {
    return {
      durationProbeStatus: "failed",
      durationProbeNote: `Duration probe failed: ${String(error)}`,
    };
  }
}

export async function hydrateAiCandidates(
  candidates: AiAssetCandidate[],
): Promise<HydrateCandidatesResult> {
  const warnings: string[] = [];
  const tooling = detectVideoTooling();

  if (!isNodeEnabled()) {
    return {
      candidates: candidates.map((candidate) => ({
        ...candidate,
        descriptor: candidate.descriptor ?? buildFilenameDescriptor(candidate),
      })),
      warnings,
      tooling,
      cacheHits: 0,
    };
  }

  const enriched: AiAssetCandidate[] = [];
  let cacheHits = 0;

  for (const candidate of candidates) {
    const cacheKey = buildHydrationCacheKey(candidate, tooling);
    const cached = hydrationCache.get(cacheKey);
    if (cached) {
      cacheHits += 1;
      enriched.push({
        ...cached.candidate,
        id: candidate.id,
        path: candidate.path,
        name: candidate.name,
        mediaType: candidate.mediaType,
      });
      continue;
    }

    if (candidate.mediaType === "image") {
      const hydratedCandidate = {
        ...candidate,
        descriptor: candidate.descriptor ?? buildFilenameDescriptor(candidate),
        visualPaths: [candidate.path],
      };
      hydrationCache.set(cacheKey, { candidate: hydratedCandidate, warnings: [] });
      enriched.push(hydratedCandidate);
      continue;
    }

    const videoResult = hydrateVideoCandidate(candidate, tooling);
    hydrationCache.set(cacheKey, videoResult);
    enriched.push(videoResult.candidate);
    warnings.push(...videoResult.warnings);
  }

  return { candidates: enriched, warnings, tooling, cacheHits };
}

export async function indexMediaLibraryForAi(
  mediaItems: MediaLibraryItem[],
  onProgress?: (done: number, total: number) => void,
): Promise<LibraryIndexResult> {
  const candidates = mediaItems.map<AiAssetCandidate>((item) => ({
    id: normalizePath(item.path),
    path: item.path,
    name: getFileName(item.path),
    mediaType: item.type,
    folderKeywords: buildFolderKeywords(item.path),
  }));
  const hydrated: AiAssetCandidate[] = [];
  const warnings: string[] = [];
  let cacheHits = 0;
  let tooling = detectVideoTooling();

  for (let index = 0; index < candidates.length; index += 1) {
    const result = await hydrateAiCandidates([candidates[index]]);
    hydrated.push(...result.candidates);
    warnings.push(...result.warnings);
    cacheHits += result.cacheHits;
    tooling = result.tooling;
    onProgress?.(index + 1, candidates.length);
  }

  return {
    candidates: hydrated,
    warnings,
    tooling,
    cacheHits,
    indexedCount: hydrated.length,
  };
}

function buildHydrationCacheKey(candidate: AiAssetCandidate, tooling: VideoToolingStatus): string {
  return [
    normalizePath(candidate.path),
    candidate.mediaType,
    tooling.ffprobeAvailable ? "ffprobe" : "no-ffprobe",
    tooling.ffmpegAvailable ? "ffmpeg" : "no-ffmpeg",
    "samples-v1",
  ].join("|");
}

function hydrateVideoCandidate(
  candidate: AiAssetCandidate,
  tooling: VideoToolingStatus,
): { candidate: AiAssetCandidate; warnings: string[] } {
  const warnings: string[] = [];
  let durationSec = candidate.durationSec;
  let sampleTimestampsSec = candidate.sampleTimestampsSec;
  let visualPaths = candidate.visualPaths;

  if (tooling.ffprobeAvailable) {
    try {
      durationSec = getVideoDuration(candidate.path);
      sampleTimestampsSec = buildSampleTimestamps(durationSec);
    } catch (error) {
      warnings.push(`ffprobe failed for ${candidate.name}: ${String(error)}`);
    }
  }

  if (tooling.ffmpegAvailable && sampleTimestampsSec && sampleTimestampsSec.length > 0) {
    try {
      visualPaths = extractFrames(candidate.path, sampleTimestampsSec);
    } catch (error) {
      warnings.push(`ffmpeg frame extraction failed for ${candidate.name}: ${String(error)}`);
    }
  }

  return {
    candidate: {
      ...candidate,
      descriptor: buildVideoDescriptor(candidate, durationSec, sampleTimestampsSec),
      durationSec,
      sampleTimestampsSec,
      visualPaths,
    },
    warnings,
  };
}

function buildFilenameDescriptor(candidate: AiAssetCandidate): string {
  return [
    `Filename: ${getFileName(candidate.path)}.`,
    `Media type: ${candidate.mediaType}.`,
    candidate.folderKeywords?.length ? `Folder context: ${candidate.folderKeywords.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
}

function buildVideoDescriptor(
  candidate: AiAssetCandidate,
  durationSec?: number,
  sampleTimestampsSec?: number[],
): string {
  const parts = [
    `Filename: ${getFileName(candidate.path)}.`,
    "Media type: video.",
    candidate.folderKeywords?.length ? `Folder context: ${candidate.folderKeywords.join(", ")}.` : "",
  ];

  if (typeof durationSec === "number" && Number.isFinite(durationSec)) {
    parts.push(`Duration: ${durationSec.toFixed(2)} seconds.`);
  }

  if (sampleTimestampsSec?.length) {
    parts.push(`Sample timestamps: ${sampleTimestampsSec.map((value) => value.toFixed(2)).join(", ")}.`);
  }

  return parts.join(" ");
}

function buildFolderKeywords(filePath: string): string[] {
  const normalized = normalizePath(filePath);
  const parts = normalized.split("/").slice(-4, -1);
  const tokens = new Set<string>();
  parts.forEach((part) => {
    part
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2)
      .forEach((token) => tokens.add(token));
  });
  return Array.from(tokens).slice(0, 16);
}

function buildSampleTimestamps(durationSec?: number): number[] {
  if (!durationSec || !Number.isFinite(durationSec) || durationSec <= 0.5) {
    return [0];
  }

  const anchors = [0.15, 0.5, 0.85];
  return anchors
    .map((ratio) => Math.max(0, Math.min(durationSec - 0.1, durationSec * ratio)))
    .map((value) => Math.round(value * 100) / 100);
}

function getVideoDuration(filePath: string): number {
  const binaries = resolveVideoBinaries();
  if (!binaries.ffprobe) {
    throw new Error("ffprobe is not available. Install FFmpeg or refresh PATH.");
  }
  const { childProcess } = getNodeModules();
  const output = childProcess.execFileSync(
    binaries.ffprobe,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      normalizePath(filePath),
    ],
    { encoding: "utf8", stdio: "pipe" },
  );
  const parsed = Number(String(output).trim());

  if (!Number.isFinite(parsed)) {
    throw new Error(`Could not parse duration from ffprobe output: ${output}`);
  }

  return parsed;
}

function extractFrames(filePath: string, timestampsSec: number[]): string[] {
  const binaries = resolveVideoBinaries();
  if (!binaries.ffmpeg) {
    throw new Error("ffmpeg is not available. Install FFmpeg or refresh PATH.");
  }
  const { childProcess, fs, os, path } = getNodeModules();
  const targetDirectory = path.join(os.tmpdir(), "weave-edit-video-frames");
  fs.mkdirSync(targetDirectory, { recursive: true });

  return timestampsSec.map((timestampSec, index) => {
    const outputPath = normalizePath(
      path.join(
        targetDirectory,
        `${Date.now()}-${sanitizeName(getFileName(filePath))}-${index + 1}.jpg`,
      ),
    );

    childProcess.execFileSync(
      binaries.ffmpeg,
      [
        "-y",
        "-ss",
        String(timestampSec),
        "-i",
        normalizePath(filePath),
        "-frames:v",
        "1",
        outputPath,
      ],
      { stdio: "ignore" },
    );

    return outputPath;
  });
}

function sanitizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function commandExists(
  execFileSync: NodeModules["childProcess"]["execFileSync"],
  command: string,
): boolean {
  try {
    execFileSync(command, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function resolveVideoBinaries(): { ffmpeg: string | null; ffprobe: string | null } {
  if (cachedVideoBinaries) {
    return cachedVideoBinaries;
  }

  const { childProcess, fs, os, path } = getNodeModules();

  const ffmpeg =
    resolveExecutableFromPath(childProcess.execFileSync, "ffmpeg") ??
    resolveExecutableFromWinget(fs, path, os, "ffmpeg");
  const ffprobe =
    resolveExecutableFromPath(childProcess.execFileSync, "ffprobe") ??
    resolveExecutableFromWinget(fs, path, os, "ffprobe");

  cachedVideoBinaries = { ffmpeg, ffprobe };
  return cachedVideoBinaries;
}

function resolveExecutableFromPath(
  execFileSync: NodeModules["childProcess"]["execFileSync"],
  command: string,
): string | null {
  if (!commandExists(execFileSync, command)) {
    return null;
  }
  return command;
}

function resolveExecutableFromWinget(
  fs: NodeModules["fs"],
  path: NodeModules["path"],
  os: NodeModules["os"],
  command: "ffmpeg" | "ffprobe",
): string | null {
  const localAppData = processEnv("LOCALAPPDATA") ?? path.join(os.tmpdir(), "..", "..");
  const packagesRoot = path.join(localAppData, "Microsoft", "WinGet", "Packages");

  if (!fs.existsSync(packagesRoot)) {
    return null;
  }

  let packageFolders: string[] = [];
  try {
    packageFolders = fs.readdirSync(packagesRoot);
  } catch {
    return null;
  }

  const candidates = packageFolders
    .filter((folder) => /^Gyan\.FFmpeg_/i.test(folder))
    .sort((left, right) => right.localeCompare(left));

  for (const folder of candidates) {
    const packageRoot = path.join(packagesRoot, folder);
    let subFolders: string[] = [];
    try {
      subFolders = fs.readdirSync(packageRoot);
    } catch {
      continue;
    }

    const builds = subFolders.filter((entry) => /^ffmpeg-/i.test(entry)).sort((left, right) => right.localeCompare(left));
    for (const buildFolder of builds) {
      const executablePath = path.join(packageRoot, buildFolder, "bin", `${command}.exe`);
      if (fs.existsSync(executablePath)) {
        return normalizePath(executablePath);
      }
    }
  }

  return null;
}

function processEnv(name: string): string | undefined {
  try {
    const nodeRequire = window.require as NodeRequire;
    const processModule = nodeRequire("process") as { env?: Record<string, string | undefined> };
    return processModule.env?.[name];
  } catch {
    return undefined;
  }
}

function isNodeEnabled(): boolean {
  return typeof window.require === "function";
}

function getNodeModules(): NodeModules {
  if (!isNodeEnabled()) {
    throw new Error("Node.js is not enabled in the CEP panel.");
  }

  const nodeRequire = window.require as NodeRequire;
  return {
    childProcess: nodeRequire("child_process") as NodeModules["childProcess"],
    fs: nodeRequire("fs") as NodeModules["fs"],
    os: nodeRequire("os") as NodeModules["os"],
    path: nodeRequire("path") as NodeModules["path"],
  };
}
