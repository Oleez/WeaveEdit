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

export function detectVideoTooling(): VideoToolingStatus {
  if (!isNodeEnabled()) {
    return { ffmpegAvailable: false, ffprobeAvailable: false };
  }

  const { childProcess } = getNodeModules();

  return {
    ffmpegAvailable: commandExists(childProcess.execFileSync, "ffmpeg"),
    ffprobeAvailable: commandExists(childProcess.execFileSync, "ffprobe"),
  };
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
  return `Filename: ${getFileName(candidate.path)}. Media type: ${candidate.mediaType}.`;
}

function buildVideoDescriptor(
  candidate: AiAssetCandidate,
  durationSec?: number,
  sampleTimestampsSec?: number[],
): string {
  const parts = [
    `Filename: ${getFileName(candidate.path)}.`,
    "Media type: video.",
  ];

  if (typeof durationSec === "number" && Number.isFinite(durationSec)) {
    parts.push(`Duration: ${durationSec.toFixed(2)} seconds.`);
  }

  if (sampleTimestampsSec?.length) {
    parts.push(`Sample timestamps: ${sampleTimestampsSec.map((value) => value.toFixed(2)).join(", ")}.`);
  }

  return parts.join(" ");
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
  const { childProcess } = getNodeModules();
  const output = childProcess.execFileSync(
    "ffprobe",
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
      "ffmpeg",
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
