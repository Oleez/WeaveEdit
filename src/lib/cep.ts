import { TimelinePlacement } from "./timeline-plan";

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
    startSec: number;
    endSec: number;
    durationSec: number;
    imagePath: string | null;
    strategy: TimelinePlacement["strategy"];
    text: string;
  }>;
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

const IMAGE_EXTENSIONS = new Set([
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
]);

let hostLoaded = false;

export function isCepEnvironment(): boolean {
  return Boolean(window.__adobe_cep__?.evalScript);
}

export function isNodeEnabled(): boolean {
  return typeof window.require === "function";
}

export async function pickFolder(): Promise<string | null> {
  const result = window.cep?.fs?.showOpenDialogEx?.(
    false,
    true,
    "Choose image folder",
    "",
    [],
    [],
  );

  if (!result || result.err || !Array.isArray(result.data) || result.data.length === 0) {
    return null;
  }

  return normalizePath(result.data[0]);
}

export function listImageFiles(folderPath: string): string[] {
  const { fs, path } = getNodeModules();
  const collected: string[] = [];

  function walk(currentPath: string) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    entries.forEach((entry) => {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        return;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (IMAGE_EXTENSIONS.has(extension)) {
        collected.push(normalizePath(fullPath));
      }
    });
  }

  walk(folderPath);
  return collected.sort((left, right) => left.localeCompare(right));
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

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function escapeForJsx(filePath: string): string {
  return normalizePath(filePath).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
