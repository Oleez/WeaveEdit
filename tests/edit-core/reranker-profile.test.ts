import { describe, expect, it } from "vitest";
import { rerankGeneratedAssetsForPlacements } from "@/lib/ai/generated-asset-reranker";
import type { CreatorProfile } from "@/lib/edit-core/creator-profile";
import type { TimelinePlacement } from "@/lib/timeline-plan";
import type { ImportedGeneratedAsset } from "@/lib/ai/types";

const basePlacement: TimelinePlacement = {
  id: "placement-1",
  groupId: "group-1",
  segmentId: "seg-1",
  layerIndex: 0,
  trackOffset: 0,
  startSec: 0,
  endSec: 4,
  durationSec: 4,
  strategy: "blank",
  mediaPath: null,
  mediaName: null,
  mediaType: null,
  text: "Cinematic intro about a city sunrise",
  keywordScore: 0.4,
  aiConfidence: 0,
  aiRationale: null,
  aiVisualMatchReason: null,
  matchKind: null,
  mediaPreference: null,
  aiProvider: null,
  lowConfidence: false,
  fallbackReason: null,
  timingSource: "segment",
  timingRationale: null,
  overlapStyle: "single",
  editorialRole: "hook",
  sourceInSec: null,
  sourceOutSec: null,
  sourceDurationSec: null,
  trimApplied: false,
  trimNote: null,
};

const baseAsset: ImportedGeneratedAsset = {
  id: "asset-1",
  fileName: "sunrise_city.jpg",
  filePath: "/generated/sunrise_city.jpg",
  fileType: "image",
  linkedPromptId: "prompt-1",
  linkedPlacementId: "placement-other",
  linkedSegmentId: "seg-1",
  timestampStartSec: 0,
  timestampEndSec: 4,
  sourceTool: "sora",
  status: "approved",
  notes: "",
  importedAt: "2026-01-01T00:00:00.000Z",
  intendedUsage: "broll-replacement",
  requestedAssetType: "image",
  replaceOrEnhance: "broll-replacement",
  visualSummary: "Aerial view of a city skyline at sunrise",
  visualKeywords: ["city", "sunrise", "skyline"],
  visualStyle: ["cinematic"],
  moodTags: ["uplifting"],
  likelyUseCases: ["hook"],
  editorialRoleFit: ["hook"],
  matchKind: "literal",
  analysisStatus: "available",
};

const baseProfile: CreatorProfile = {
  likedPlacementIds: [],
  dislikedPlacementIds: [],
  acceptedSuggestionCount: 0,
  rejectedSuggestionCount: 0,
  semanticHints: [],
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("rerankGeneratedAssetsForPlacements creator profile", () => {
  it("boosts confidence when liked placement ids and semantic hints align", () => {
    const profile: CreatorProfile = {
      ...baseProfile,
      likedPlacementIds: ["placement-1"],
      semanticHints: ["cinematic", "hook", "literal"],
    };

    const baseline = rerankGeneratedAssetsForPlacements({
      placements: [basePlacement],
      assets: [baseAsset],
    });
    const boosted = rerankGeneratedAssetsForPlacements({
      placements: [basePlacement],
      assets: [baseAsset],
      creatorProfile: profile,
    });

    expect(boosted.suggestions[0]?.confidence ?? 0).toBeGreaterThan(
      baseline.suggestions[0]?.confidence ?? 0,
    );
    expect(boosted.suggestions[0]?.matchReason).toContain("creator preferences");
  });

  it("penalises disliked placements", () => {
    const baseline = rerankGeneratedAssetsForPlacements({
      placements: [basePlacement],
      assets: [baseAsset],
    });
    const penalised = rerankGeneratedAssetsForPlacements({
      placements: [basePlacement],
      assets: [baseAsset],
      creatorProfile: {
        ...baseProfile,
        dislikedPlacementIds: ["placement-1"],
      },
    });

    expect(penalised.suggestions[0]?.confidence ?? 1).toBeLessThan(
      baseline.suggestions[0]?.confidence ?? 1,
    );
  });
});
