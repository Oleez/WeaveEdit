import { AiHealthStatus, AiModelProfile, AiScoringContext, AiSegmentRanking, AiSegmentRequest } from "./types";

export interface AiProvider {
  providerName: string;
  healthCheck(context: AiScoringContext): Promise<AiHealthStatus>;
  rankAssetsForSegment(
    request: AiSegmentRequest,
    context: AiScoringContext,
  ): Promise<AiSegmentRanking>;
  getModelProfile(context: AiScoringContext): AiModelProfile;
}

export function sanitizeCandidates(
  requests: AiSegmentRequest[],
  maxCandidatesPerSegment: number,
): AiSegmentRequest[] {
  return requests.map((request) => ({
    ...request,
    candidates: request.candidates.slice(0, maxCandidatesPerSegment),
    maxRecommendations: Math.min(
      request.maxRecommendations ?? 3,
      maxCandidatesPerSegment,
      request.candidates.length,
    ),
  }));
}

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}
