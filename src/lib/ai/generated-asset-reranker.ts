import type { TimelinePlacement } from "../timeline-plan";
import type { CreatorProfile } from "../edit-core/creator-profile";
import type {
  GeneratedAssetMatchSuggestion,
  GeneratedAssetRerankResult,
  ImportedGeneratedAsset,
} from "./types";

interface GeneratedAssetRerankInput {
  placements: TimelinePlacement[];
  assets: ImportedGeneratedAsset[];
  promptRecommendedPlacementIds?: Set<string>;
  appliedAssetIdsByPlacementId?: Record<string, string>;
  allowReplacingStrongMatches?: boolean;
  fileExists?: (filePath: string) => boolean | null;
  editGoal?: string;
  editStyle?: string;
  brollStyle?: string;
  captionStyle?: string;
  creativeDirection?: string;
  brandNotes?: string;
  creatorProfile?: CreatorProfile;
}

interface ScoredSuggestion {
  suggestion: GeneratedAssetMatchSuggestion;
  asset: ImportedGeneratedAsset;
}

export function rerankGeneratedAssetsForPlacements(
  input: GeneratedAssetRerankInput,
): GeneratedAssetRerankResult {
  const skippedReasons: string[] = [];
  const reusableAssets = input.assets.filter((asset) => {
    if (asset.status !== "approved") {
      return false;
    }
    if (asset.fileType !== "image" && asset.fileType !== "video") {
      skippedReasons.push(`${asset.fileName}: unsupported file type ${asset.fileType}`);
      return false;
    }
    const exists = input.fileExists?.(asset.filePath);
    if (exists === false) {
      skippedReasons.push(`${asset.fileName}: file missing`);
      return false;
    }
    return true;
  });

  if (reusableAssets.length === 0) {
    return {
      suggestions: [],
      highConfidenceCount: 0,
      skippedCount: skippedReasons.length,
      skippedReasons: skippedReasons.length ? skippedReasons : ["No approved generated image/video assets are ready."],
      generatedAt: new Date().toISOString(),
    };
  }

  const usedAssetIds = new Set<string>();
  const suggestions: GeneratedAssetMatchSuggestion[] = [];

  input.placements.forEach((placement) => {
    const eligibility = getPlacementEligibility(
      placement,
      input.promptRecommendedPlacementIds,
      input.allowReplacingStrongMatches,
    );
    if (!eligibility) {
      skippedReasons.push(`${placement.id}: protected strong local/AI match`);
      return;
    }

    const best = reusableAssets
      .map((asset) =>
        scoreAssetForPlacement(asset, placement, eligibility, input, usedAssetIds),
      )
      .filter((result): result is ScoredSuggestion => Boolean(result))
      .sort((left, right) => right.suggestion.confidence - left.suggestion.confidence)[0];

    if (!best) {
      skippedReasons.push(`${placement.id}: no relevant approved generated asset match`);
      return;
    }

    if (best.suggestion.confidence < 0.42) {
      skippedReasons.push(`${placement.id}: best generated asset match was too weak`);
      return;
    }

    usedAssetIds.add(best.asset.id);
    suggestions.push({
      ...best.suggestion,
      applyStatus:
        input.appliedAssetIdsByPlacementId?.[placement.id] === best.asset.id
          ? "applied"
          : "suggested",
    });
  });

  return {
    suggestions,
    highConfidenceCount: suggestions.filter((suggestion) => suggestion.confidence >= 0.68).length,
    skippedCount: skippedReasons.length,
    skippedReasons,
    generatedAt: new Date().toISOString(),
  };
}

function getPlacementEligibility(
  placement: TimelinePlacement,
  promptRecommendedPlacementIds?: Set<string>,
  allowReplacingStrongMatches?: boolean,
): GeneratedAssetMatchSuggestion["replaces"] | null {
  if (placement.strategy === "blank") {
    return "blank";
  }
  if (placement.strategy === "fallback") {
    return "fallback";
  }
  if (placement.lowConfidence) {
    return "low-confidence";
  }
  if (promptRecommendedPlacementIds?.has(placement.id)) {
    return "prompt-recommended";
  }
  if (placement.generatedAssetId) {
    return "generated-ready";
  }
  return allowReplacingStrongMatches ? "generated-ready" : null;
}

function scoreAssetForPlacement(
  asset: ImportedGeneratedAsset,
  placement: TimelinePlacement,
  replaces: GeneratedAssetMatchSuggestion["replaces"],
  input: GeneratedAssetRerankInput,
  usedAssetIds: Set<string>,
): ScoredSuggestion | null {
  const placementTokens = tokenize(
    [
      placement.text,
      placement.editorialRole,
      placement.aiVisualMatchReason,
      placement.aiRationale,
      input.editGoal,
      input.editStyle,
      input.brollStyle,
      input.captionStyle,
      input.creativeDirection,
      input.brandNotes,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const assetTokens = tokenize(
    [
      asset.fileName,
      asset.visualSummary,
      asset.visualKeywords?.join(" "),
      asset.visualStyle?.join(" "),
      asset.moodTags?.join(" "),
      asset.likelyUseCases?.join(" "),
      asset.editorialRoleFit?.join(" "),
      asset.notes,
      asset.intendedUsage,
      asset.requestedAssetType,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const overlap = scoreTokenOverlap(placementTokens, new Set(assetTokens));
  const linkedBonus = asset.linkedPlacementId === placement.id ? 0.28 : 0;
  const roleBonus = asset.editorialRoleFit?.includes(placement.editorialRole) ? 0.16 : 0;
  const analysisBonus = asset.analysisStatus === "available" ? 0.13 : 0.03;
  const typeBonus = placement.mediaPreference === asset.fileType ? 0.07 : 0;
  const reusePenalty = usedAssetIds.has(asset.id) ? 0.22 : 0;
  const creatorBonus = scoreCreatorProfileBonus(asset, placement, assetTokens, input.creatorProfile);
  const confidence = clamp01(0.12 + overlap + linkedBonus + roleBonus + analysisBonus + typeBonus + creatorBonus - reusePenalty);

  if (confidence <= 0.2) {
    return null;
  }

  const matchKind = asset.matchKind ?? inferMatchKind(asset, overlap);
  return {
    asset,
    suggestion: {
      id: `generated-suggestion-${placement.id}-${asset.id}`,
      placementId: placement.id,
      generatedAssetId: asset.id,
      startSec: placement.startSec,
      endSec: placement.endSec,
      transcriptText: placement.text,
      confidence,
      matchReason: buildMatchReason(asset, placement, overlap, linkedBonus, roleBonus, creatorBonus),
      matchKind,
      replaces,
      sourceTool: asset.sourceTool,
      assetFileName: asset.fileName,
      assetVisualSummary: asset.visualSummary,
      applyStatus: "suggested",
    },
  };
}

function buildMatchReason(
  asset: ImportedGeneratedAsset,
  placement: TimelinePlacement,
  overlap: number,
  linkedBonus: number,
  roleBonus: number,
  creatorBonus = 0,
): string {
  const reasons = [];
  if (linkedBonus > 0) {
    reasons.push("linked to this prompt/placement");
  }
  if (roleBonus > 0) {
    reasons.push(`fits ${placement.editorialRole} role`);
  }
  if (asset.visualSummary) {
    reasons.push(`visual profile: ${asset.visualSummary}`);
  }
  if (overlap > 0.12) {
    reasons.push("metadata overlaps with transcript idea");
  }
  if (creatorBonus > 0) {
    reasons.push("aligns with learned creator preferences");
  }
  return reasons.join("; ") || "approved generated asset has the best available metadata match.";
}

function scoreCreatorProfileBonus(
  asset: ImportedGeneratedAsset,
  placement: TimelinePlacement,
  assetTokens: string[],
  profile?: CreatorProfile,
): number {
  if (
    !profile ||
    (profile.likedPlacementIds.length === 0 &&
      profile.dislikedPlacementIds.length === 0 &&
      profile.semanticHints.length === 0)
  ) {
    return 0;
  }
  let bonus = 0;
  if (profile.dislikedPlacementIds.includes(placement.id)) {
    bonus -= 0.12;
  }
  const liked = new Set(profile.likedPlacementIds);
  if (liked.has(placement.id)) {
    bonus += 0.08;
  }
  if (profile.semanticHints.length > 0) {
    const hintSet = new Set(profile.semanticHints.map((hint) => hint.toLowerCase()));
    const tokenHits = assetTokens.filter((token) => hintSet.has(token)).length;
    if (tokenHits > 0) {
      bonus += Math.min(0.12, tokenHits * 0.04);
    }
    if (asset.editorialRoleFit?.some((role) => hintSet.has(role))) {
      bonus += 0.05;
    }
    if (asset.matchKind && hintSet.has(asset.matchKind)) {
      bonus += 0.04;
    }
  }
  return Math.max(-0.15, Math.min(0.2, bonus));
}

function inferMatchKind(
  asset: ImportedGeneratedAsset,
  overlap: number,
): GeneratedAssetMatchSuggestion["matchKind"] {
  if (asset.visualStyle?.includes("overlay")) return "overlay";
  if (asset.visualStyle?.includes("texture")) return "texture";
  if (asset.visualStyle?.includes("background")) return "background";
  if (overlap > 0.18) return "literal";
  return "metaphorical";
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function scoreTokenOverlap(textTokens: string[], assetTokens: Set<string>): number {
  if (textTokens.length === 0 || assetTokens.size === 0) {
    return 0;
  }
  const matches = textTokens.filter((token) => assetTokens.has(token)).length;
  return Math.min(0.46, matches / Math.max(5, textTokens.length));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "because",
  "from",
  "have",
  "into",
  "just",
  "like",
  "more",
  "only",
  "that",
  "then",
  "they",
  "this",
  "very",
  "what",
  "when",
  "with",
  "your",
]);
