import { beforeEach, describe, expect, it } from "vitest";
import {
  GLOBAL_SETTINGS_KEY,
  LEGACY_SETTINGS_KEY,
  MIGRATION_FLAG_KEY,
  loadGlobalSettings,
  loadProjectSettings,
  migrateLegacySettings,
  resetProjectSettings,
  saveGlobalSettings,
  saveProjectSettings,
} from "../../src/lib/edit-core/project-settings-store";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

Object.defineProperty(globalThis, "localStorage", {
  value: new MemoryStorage(),
  configurable: true,
});

const globalSettings = {
  aiMode: "local" as const,
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "gemma",
  geminiModel: "gemini",
  aiConfidenceThreshold: 0.5,
  cutBoundaryMode: "sentence" as const,
  matchStyle: "literal" as const,
  assetReusePolicy: "avoid-repeat" as const,
  videoTrimPolicy: "trim-to-beat" as const,
  analysisDepth: "visual-frames" as const,
  candidatePoolSize: 20,
  rerankDepth: 6,
  libraryMode: "mixed" as const,
  mediaSortMode: "name" as const,
  transcriptSourceMode: "premiere-markers" as const,
  minDurationSec: 1,
  maxDurationSec: 8,
};

const projectSettings = {
  scriptText: "00:00 hello",
  imageFolderPath: "C:/project-a/media",
  generatedAssets: [],
  customInstructions: "make it sharp",
  editGoal: "views-retention",
  editStyle: "fast-viral",
  brollStyle: "mixed",
  captionStyle: "clean-bold",
  ctaContext: "",
  creativeDirection: "",
  brandNotes: "",
  placementStrategyMode: "ai-dynamic" as const,
  averageShotLengthSec: 4,
  variationStrength: 0.3,
  pacingPreset: "social-fast" as const,
  targetVideoTrack: 2,
  targetAudioTrack: 1,
  silenceThresholdDb: -45,
  minSilenceSec: 0.35,
  keepSilenceSec: 0.05,
  appendAtTrackEnd: false,
  useWholeSequenceFallback: true,
};

describe("project-settings-store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("isolates project settings by projectId", () => {
    saveProjectSettings("project-a", projectSettings);
    saveProjectSettings("project-b", { ...projectSettings, scriptText: "project b" });

    expect(loadProjectSettings("project-a").scriptText).toBe("00:00 hello");
    expect(loadProjectSettings("project-b").scriptText).toBe("project b");
  });

  it("no-ops project load/save without a project id", () => {
    saveProjectSettings(null, projectSettings);

    expect(loadProjectSettings(null)).toEqual({});
    expect(localStorage.length).toBe(0);
  });

  it("migrates legacy settings into global and current project slots once", () => {
    localStorage.setItem(
      LEGACY_SETTINGS_KEY,
      JSON.stringify({ ...globalSettings, ...projectSettings }),
    );

    migrateLegacySettings("project-a");

    expect(loadGlobalSettings()).toMatchObject({
      aiMode: "local",
      ollamaModel: "gemma",
      libraryMode: "mixed",
    });
    expect(loadProjectSettings("project-a")).toMatchObject({
      scriptText: "00:00 hello",
      imageFolderPath: "C:/project-a/media",
    });
    expect(localStorage.getItem(LEGACY_SETTINGS_KEY)).toBeNull();
    expect(localStorage.getItem(MIGRATION_FLAG_KEY)).toBe("done");
  });

  it("resetProjectSettings removes only the requested project slot", () => {
    saveGlobalSettings(globalSettings);
    saveProjectSettings("project-a", projectSettings);
    saveProjectSettings("project-b", { ...projectSettings, scriptText: "project b" });

    resetProjectSettings("project-a");

    expect(loadProjectSettings("project-a")).toEqual({});
    expect(loadProjectSettings("project-b").scriptText).toBe("project b");
    expect(localStorage.getItem(GLOBAL_SETTINGS_KEY)).not.toBeNull();
  });
});
