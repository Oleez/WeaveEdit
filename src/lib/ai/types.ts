export type AiMode = "off" | "local" | "hybrid";

export interface AiAssetCandidate {
  id: string;
  path: string;
  name: string;
}

export interface AiSegmentRequest {
  segmentId: string;
  text: string;
  startSec: number;
  endSec: number | null;
  candidates: AiAssetCandidate[];
  maxRecommendations?: number;
}

export interface AiRankedAsset {
  candidateId: string;
  score: number;
  rationale: string;
}

export interface AiSegmentRanking {
  provider: string;
  segmentId: string;
  confidence: number;
  rationale: string;
  rankedAssets: AiRankedAsset[];
  fallbackUsed: boolean;
}

export interface AiHealthStatus {
  provider: string;
  ok: boolean;
  message: string;
  latencyMs: number;
}

export interface AiScoringContext {
  ollamaBaseUrl: string;
  ollamaModel: string;
  geminiModel: string;
  geminiApiKey?: string;
  timeoutMs?: number;
}

export interface AiBatchResult {
  rankingsBySegmentId: Record<string, AiSegmentRanking>;
  providersUsed: string[];
  errors: string[];
}

export interface AiModelProfile {
  provider: string;
  model: string;
  maxCandidatesPerSegment: number;
  maxSegmentsPerBatch: number;
}
