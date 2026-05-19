import { TimelinePlacement } from "@/lib/timeline-plan";

const CREATOR_PROFILE_KEY = "weave-edit-creator-profile";
const PROJECT_CREATOR_PROFILE_PREFIX = "weave-edit-creator-profile:";

export interface CreatorProfile {
  likedPlacementIds: string[];
  dislikedPlacementIds: string[];
  acceptedSuggestionCount: number;
  rejectedSuggestionCount: number;
  preferredPacing?: string;
  semanticHints: string[];
  updatedAt: string;
}

export function loadCreatorProfile(): CreatorProfile {
  const fallback = createEmptyProfile();
  if (typeof localStorage === "undefined") {
    return fallback;
  }

  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(CREATOR_PROFILE_KEY) ?? "{}") };
  } catch {
    return fallback;
  }
}

export function saveCreatorProfile(profile: CreatorProfile): CreatorProfile {
  const next = { ...profile, updatedAt: new Date().toISOString() };
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(CREATOR_PROFILE_KEY, JSON.stringify(next));
  }
  return next;
}

export function loadProjectCreatorOverride(projectId: string | null): Partial<CreatorProfile> | null {
  if (!projectId || typeof localStorage === "undefined") {
    return null;
  }

  try {
    return JSON.parse(localStorage.getItem(projectCreatorProfileKey(projectId)) ?? "null") as Partial<CreatorProfile> | null;
  } catch {
    return null;
  }
}

export function saveProjectCreatorOverride(projectId: string, profile: CreatorProfile): CreatorProfile {
  const next = { ...profile, updatedAt: new Date().toISOString() };
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(projectCreatorProfileKey(projectId), JSON.stringify(next));
  }
  return next;
}

export function resetProjectCreatorOverride(projectId: string): void {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(projectCreatorProfileKey(projectId));
  }
}

export function mergeCreatorProfile(
  globalProfile: CreatorProfile,
  override: Partial<CreatorProfile> | null,
): CreatorProfile {
  if (!override) {
    return globalProfile;
  }

  return {
    ...globalProfile,
    ...override,
    likedPlacementIds: override.likedPlacementIds ?? globalProfile.likedPlacementIds,
    dislikedPlacementIds: override.dislikedPlacementIds ?? globalProfile.dislikedPlacementIds,
    acceptedSuggestionCount:
      globalProfile.acceptedSuggestionCount + (override.acceptedSuggestionCount ?? 0),
    rejectedSuggestionCount:
      globalProfile.rejectedSuggestionCount + (override.rejectedSuggestionCount ?? 0),
    semanticHints: Array.from(new Set([
      ...globalProfile.semanticHints,
      ...(override.semanticHints ?? []),
    ])).slice(-40),
    updatedAt: override.updatedAt ?? globalProfile.updatedAt,
  };
}

export function recordPlacementPreference(
  profile: CreatorProfile,
  placement: TimelinePlacement,
  preference: "liked" | "disliked",
): CreatorProfile {
  const liked = new Set(profile.likedPlacementIds);
  const disliked = new Set(profile.dislikedPlacementIds);
  if (preference === "liked") {
    liked.add(placement.id);
    disliked.delete(placement.id);
  } else {
    disliked.add(placement.id);
    liked.delete(placement.id);
  }

  const semanticHints = new Set(profile.semanticHints);
  [placement.editorialRole, placement.matchKind, placement.mediaPreference]
    .filter(Boolean)
    .forEach((hint) => semanticHints.add(String(hint)));

  return saveCreatorProfile({
    ...profile,
    likedPlacementIds: Array.from(liked),
    dislikedPlacementIds: Array.from(disliked),
    semanticHints: Array.from(semanticHints).slice(-40),
  });
}

export function recordProjectPlacementPreference(
  projectId: string,
  effectiveProfile: CreatorProfile,
  placement: TimelinePlacement,
  preference: "liked" | "disliked",
): CreatorProfile {
  const liked = new Set(effectiveProfile.likedPlacementIds);
  const disliked = new Set(effectiveProfile.dislikedPlacementIds);
  if (preference === "liked") {
    liked.add(placement.id);
    disliked.delete(placement.id);
  } else {
    disliked.add(placement.id);
    liked.delete(placement.id);
  }

  const semanticHints = new Set(effectiveProfile.semanticHints);
  [placement.editorialRole, placement.matchKind, placement.mediaPreference]
    .filter(Boolean)
    .forEach((hint) => semanticHints.add(String(hint)));

  return saveProjectCreatorOverride(projectId, {
    ...effectiveProfile,
    likedPlacementIds: Array.from(liked),
    dislikedPlacementIds: Array.from(disliked),
    semanticHints: Array.from(semanticHints).slice(-40),
  });
}

export function formatCreatorProfileForPrompt(profile: CreatorProfile): string {
  return [
    `liked=${profile.likedPlacementIds.length}`,
    `disliked=${profile.dislikedPlacementIds.length}`,
    `accepted=${profile.acceptedSuggestionCount}`,
    `rejected=${profile.rejectedSuggestionCount}`,
    `pacing=${profile.preferredPacing ?? "unset"}`,
    `hints=${profile.semanticHints.join(", ") || "none"}`,
  ].join("\n");
}

function createEmptyProfile(): CreatorProfile {
  return {
    likedPlacementIds: [],
    dislikedPlacementIds: [],
    acceptedSuggestionCount: 0,
    rejectedSuggestionCount: 0,
    semanticHints: [],
    updatedAt: new Date().toISOString(),
  };
}

function projectCreatorProfileKey(projectId: string): string {
  return `${PROJECT_CREATOR_PROFILE_PREFIX}${projectId}`;
}
