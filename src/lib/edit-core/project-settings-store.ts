import {
  AnalysisDepth,
  AssetReusePolicy,
  CutBoundaryMode,
  AiMode,
  EditorPacingPreset,
  ImportedGeneratedAsset,
  MatchStyle,
  PlacementStrategyMode,
  VideoTrimPolicy,
} from "@/lib/ai/types";
import { MediaLibraryMode, MediaSortMode } from "@/lib/media";

export const LEGACY_SETTINGS_KEY = "weave-edit-settings";
export const LEGACY_SETTINGS_FALLBACK_KEY = "sora-genie-settings";
export const GLOBAL_SETTINGS_KEY = "weave-edit-global";
export const MIGRATION_FLAG_KEY = "weave-edit-migration-v1";
export const PROJECT_SETTINGS_PREFIX = "weave-edit-project:";

export interface GlobalSettings {
  aiMode: AiMode;
  ollamaBaseUrl: string;
  ollamaModel: string;
  geminiModel: string;
  aiConfidenceThreshold: number;
  cutBoundaryMode: CutBoundaryMode;
  matchStyle: MatchStyle;
  assetReusePolicy: AssetReusePolicy;
  videoTrimPolicy: VideoTrimPolicy;
  analysisDepth: AnalysisDepth;
  candidatePoolSize: number;
  rerankDepth: number;
  libraryMode: MediaLibraryMode;
  mediaSortMode: MediaSortMode;
  transcriptSourceMode: "upload" | "premiere-markers";
  minDurationSec: number;
  maxDurationSec: number;
}

export interface ProjectSettings {
  scriptText: string;
  imageFolderPath: string;
  generatedAssets: ImportedGeneratedAsset[];
  customInstructions: string;
  editGoal: string;
  editStyle: string;
  brollStyle: string;
  captionStyle: string;
  ctaContext: string;
  creativeDirection: string;
  brandNotes: string;
  placementStrategyMode: PlacementStrategyMode;
  averageShotLengthSec: number;
  variationStrength: number;
  pacingPreset: EditorPacingPreset;
  targetVideoTrack: number;
  targetAudioTrack: number;
  silenceThresholdDb: number;
  minSilenceSec: number;
  keepSilenceSec: number;
  appendAtTrackEnd: boolean;
  useWholeSequenceFallback: boolean;
}

export function loadGlobalSettings(): Partial<GlobalSettings> {
  return readJson<Partial<GlobalSettings>>(GLOBAL_SETTINGS_KEY) ?? {};
}

export function saveGlobalSettings(value: GlobalSettings): void {
  writeJson(GLOBAL_SETTINGS_KEY, value);
}

export function loadProjectSettings(projectId: string | null): Partial<ProjectSettings> {
  if (!projectId) {
    return {};
  }
  return readJson<Partial<ProjectSettings>>(projectKey(projectId)) ?? {};
}

export function saveProjectSettings(projectId: string | null, value: ProjectSettings): void {
  if (!projectId) {
    return;
  }
  writeJson(projectKey(projectId), value);
}

export function resetProjectSettings(projectId: string): void {
  getStorage()?.removeItem(projectKey(projectId));
}

export function migrateLegacySettings(projectId: string | null): void {
  const storage = getStorage();
  if (!storage || storage.getItem(MIGRATION_FLAG_KEY) || !projectId) {
    return;
  }

  const legacy = readJson<Record<string, unknown>>(LEGACY_SETTINGS_KEY)
    ?? readJson<Record<string, unknown>>(LEGACY_SETTINGS_FALLBACK_KEY);
  if (!legacy) {
    storage.setItem(MIGRATION_FLAG_KEY, "skipped");
    return;
  }

  if (!storage.getItem(GLOBAL_SETTINGS_KEY)) {
    writeJson(GLOBAL_SETTINGS_KEY, pick(legacy, GLOBAL_FIELDS));
  }
  if (!storage.getItem(projectKey(projectId))) {
    writeJson(projectKey(projectId), pick(legacy, PROJECT_FIELDS));
  }
  storage.removeItem(LEGACY_SETTINGS_KEY);
  storage.setItem(MIGRATION_FLAG_KEY, "done");
}

export function listKnownProjectIds(): string[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  const ids: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(PROJECT_SETTINGS_PREFIX)) {
      ids.push(key.slice(PROJECT_SETTINGS_PREFIX.length));
    }
  }
  return ids.sort();
}

export function projectKey(projectId: string): string {
  return `${PROJECT_SETTINGS_PREFIX}${projectId}`;
}

const GLOBAL_FIELDS = [
  "aiMode",
  "ollamaBaseUrl",
  "ollamaModel",
  "geminiModel",
  "aiConfidenceThreshold",
  "cutBoundaryMode",
  "matchStyle",
  "assetReusePolicy",
  "videoTrimPolicy",
  "analysisDepth",
  "candidatePoolSize",
  "rerankDepth",
  "libraryMode",
  "mediaSortMode",
  "transcriptSourceMode",
  "minDurationSec",
  "maxDurationSec",
];

const PROJECT_FIELDS = [
  "scriptText",
  "imageFolderPath",
  "generatedAssets",
  "customInstructions",
  "editGoal",
  "editStyle",
  "brollStyle",
  "captionStyle",
  "ctaContext",
  "creativeDirection",
  "brandNotes",
  "placementStrategyMode",
  "averageShotLengthSec",
  "variationStrength",
  "pacingPreset",
  "targetVideoTrack",
  "targetAudioTrack",
  "silenceThresholdDb",
  "minSilenceSec",
  "keepSilenceSec",
  "appendAtTrackEnd",
  "useWholeSequenceFallback",
];

function pick(source: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  return fields.reduce<Record<string, unknown>>((result, field) => {
    if (field in source) {
      result[field] = source[field];
    }
    return result;
  }, {});
}

function readJson<T>(key: string): T | null {
  try {
    const raw = getStorage()?.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  getStorage()?.setItem(key, JSON.stringify(value));
}

function getStorage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}
