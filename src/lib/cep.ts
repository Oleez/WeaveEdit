import { TimelinePlacement } from "./timeline-plan";
import {
  MediaLibraryItem,
  MediaLibraryMode,
  createMediaLibraryItem,
  normalizePath,
} from "./media";

export interface PremiereTrackStatus {
  index: number;
  name: string;
  endSec: number;
}

export interface PremiereRangeStatus {
  inSec: number;
  outSec: number;
  sequenceEndSec: number;
  hasMeaningfulInOut: boolean;
}

export interface PremiereStatus {
  ok: boolean;
  connected: boolean;
  projectName: string;
  sequenceName: string;
  videoTracks: PremiereTrackStatus[];
  range: PremiereRangeStatus;
  frameRate: number;
  message?: string;
}

export interface PremiereRunResult {
  ok: boolean;
  message: string;
  placedCount: number;
  blankCount: number;
  importedCount: number;
  appendOffsetSec: number;
  skippedCount: number;
  clippedCount: number;
  workingRangeStartSec: number;
  workingRangeEndSec: number;
  details?: string[];
}

export interface ExecuteTimelineJobInput {
  targetVideoTrackIndex: number;
  appendAtTrackEnd: boolean;
  useSequenceInOut: boolean;
  rangeStartSec: number | null;
  rangeEndSec: number | null;
  placements: Array<{
    id: string;
    groupId?: string;
    layerIndex?: number;
    trackOffset?: number;
    startSec: number;
    endSec: number;
    durationSec: number;
    mediaPath: string | null;
    strategy: TimelinePlacement["strategy"];
    text: string;
  }>;
}

export interface MediaScanResult {
  items: MediaLibraryItem[];
  warnings: string[];
}

export interface FolderPickResult {
  status: "selected" | "cancelled" | "api_unavailable" | "dialog_error";
  path: string | null;
  message?: string;
}

export interface PremiereTranscriptSegment {
  id: string;
  startSec: number;
  endSec: number | null;
  text: string;
}

type NodeRequire = (moduleName: string) => unknown;

interface NodeModules {
  fs: {
    readdirSync: (path: string, options?: { withFileTypes?: boolean }) => Array<{
      isDirectory: () => boolean;
      name: string;
    }>;
    readFileSync: (path: string, encoding: string) => string;
    writeFileSync: (path: string, data: string, encoding?: string) => void;
  };
  os: {
    tmpdir: () => string;
  };
  path: {
    join: (...parts: string[]) => string;
    extname: (path: string) => string;
    basename: (path: string) => string;
  };
  process: {
    env: Record<string, string | undefined>;
  };
}

let hostLoaded = false;

export function isCepEnvironment(): boolean {
  return Boolean(window.__adobe_cep__?.evalScript);
}

export function isNodeEnabled(): boolean {
  return typeof window.require === "function";
}

export function hasNativeFolderPicker(): boolean {
  return Boolean(window.cep?.fs?.showOpenDialogEx || window.__adobe_cep__?.evalScript);
}

export async function pickFolder(initialPath = ""): Promise<FolderPickResult> {
  const dialogApi = window.cep?.fs?.showOpenDialogEx;

  if (dialogApi) {
    const result = dialogApi(false, true, "Choose media folder", initialPath, [], []);

    if (!result) {
      return {
        status: "dialog_error",
        path: null,
        message: "Folder dialog returned no result.",
      };
    }

    if (result.err) {
      return {
        status: "dialog_error",
        path: null,
        message: `Folder dialog failed with CEP error ${result.err}.`,
      };
    }

    if (!Array.isArray(result.data) || result.data.length === 0) {
      return { status: "cancelled", path: null };
    }

    return {
      status: "selected",
      path: normalizePath(result.data[0]),
    };
  }

  if (!isCepEnvironment()) {
    return {
      status: "api_unavailable",
      path: null,
      message: "Folder picker is only available inside Premiere Pro.",
    };
  }

  await ensureHostLoaded();
  return evaluateJson<FolderPickResult>("weaveEdit.pickFolder()");
}

export function listMediaFiles(
  folderPath: string,
  mode: MediaLibraryMode = "images",
): MediaScanResult {
  const { fs, path } = getNodeModules();
  const collected = new Map<string, MediaLibraryItem>();
  const warnings: string[] = [];

  function walk(currentPath: string) {
    let entries: ReturnType<NodeModules["fs"]["readdirSync"]>;

    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (error) {
      warnings.push(`Skipped ${normalizePath(currentPath)}: ${String(error)}`);
      return;
    }

    entries.forEach((entry) => {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        return;
      }

      const item = createMediaLibraryItem(fullPath);
      if (!item) {
        return;
      }

      if (mode === "mixed" || item.type === (mode === "images" ? "image" : "video")) {
        collected.set(item.path, item);
      }
    });
  }

  walk(folderPath);
  return {
    items: Array.from(collected.values()).sort((left, right) => left.path.localeCompare(right.path)),
    warnings,
  };
}

export function getEnvironmentVariable(name: string): string | undefined {
  if (!isNodeEnabled()) {
    return undefined;
  }

  const nodeRequire = window.require as NodeRequire;
  const processModule = nodeRequire("process") as NodeModules["process"];
  return processModule.env?.[name];
}

export async function getPremiereStatus(): Promise<PremiereStatus> {
  if (!isCepEnvironment()) {
    return {
      ok: false,
      connected: false,
      projectName: "",
      sequenceName: "",
      videoTracks: [],
      frameRate: 30,
      range: {
        inSec: 0,
        outSec: 0,
        sequenceEndSec: 0,
        hasMeaningfulInOut: false,
      },
      message: "Open Weave Edit inside Premiere Pro to inspect the active sequence.",
    };
  }

  await ensureHostLoaded();
  return evaluateJson<PremiereStatus>("weaveEdit.getStatus()");
}

export async function getPremiereTranscriptSegments(): Promise<PremiereTranscriptSegment[]> {
  if (!isCepEnvironment()) {
    throw new Error("Open Weave Edit inside Premiere Pro to read sequence markers.");
  }

  await ensureHostLoaded();
  return evaluateJson<PremiereTranscriptSegment[]>("weaveEdit.getTranscriptSegments()");
}

export async function executeTimelineJob(
  payload: ExecuteTimelineJobInput,
): Promise<PremiereRunResult> {
  if (!isCepEnvironment()) {
    throw new Error("Open Weave Edit inside Premiere Pro to place clips on the timeline.");
  }

  await ensureHostLoaded();

  const tempJobPath = writeTempJob(payload);
  const escapedJobPath = escapeForJsx(tempJobPath);
  return evaluateJson<PremiereRunResult>(`weaveEdit.runJobFromFile("${escapedJobPath}")`);
}

function getNodeModules(): NodeModules {
  if (!isNodeEnabled()) {
    throw new Error("Node.js is not enabled in the CEP panel.");
  }

  const nodeRequire = window.require as NodeRequire;
  return {
    fs: nodeRequire("fs") as NodeModules["fs"],
    os: nodeRequire("os") as NodeModules["os"],
    path: nodeRequire("path") as NodeModules["path"],
    process: nodeRequire("process") as NodeModules["process"],
  };
}

async function ensureHostLoaded(): Promise<void> {
  if (hostLoaded) {
    return;
  }

  const { path } = getNodeModules();
  const extensionRoot = getExtensionRoot();
  const hostScriptPath = normalizePath(path.join(extensionRoot, "host", "premiereHost.jsx"));

  await evaluateRaw(`$.evalFile("${escapeForJsx(hostScriptPath)}")`);
  hostLoaded = true;
}

function getExtensionRoot(): string {
  const locationUrl = new URL(window.location.href);
  const normalized = decodeURIComponent(locationUrl.pathname).replace(/\/index\.html$/, "");
  return normalizePath(
    normalized.replace(/^\/([A-Za-z]:\/)/, "$1").replace(/\/$/, ""),
  );
}

function writeTempJob(payload: ExecuteTimelineJobInput): string {
  const { fs, os, path } = getNodeModules();
  const tempPath = path.join(os.tmpdir(), `weave-edit-job-${Date.now()}.json`);
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
  return normalizePath(tempPath);
}

function evaluateRaw(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    window.__adobe_cep__?.evalScript(script, (result: string) => {
      if (result === "EvalScript error.") {
        reject(new Error("Premiere rejected the panel command."));
        return;
      }

      resolve(result);
    });
  });
}

async function evaluateJson<T>(script: string): Promise<T> {
  const rawResult = await evaluateRaw(script);

  try {
    return JSON.parse(rawResult) as T;
  } catch (error) {
    throw new Error(`Failed to parse Premiere response: ${String(error)}\n${rawResult}`);
  }
}

function escapeForJsx(filePath: string): string {
  return normalizePath(filePath).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
