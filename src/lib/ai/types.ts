import { MediaType } from "../media";

export type AiMode = "off" | "local" | "hybrid";

export interface AiAssetCandidate {
  id: string;
  path: string;
  name: string;
  mediaType: MediaType;
  descriptor?: string;
  durationSec?: number;
  sampleTimestampsSec?: number[];
  visualPaths?: string[];
}

export interface AiSegmentRequest {
  segmentId: string;
  text: string;
  startSec: number;
  endSec: number | null;
  wordCount?: number;
  sentenceCount?: number;
  sentenceComplete?: boolean;
  candidates: AiAssetCandidate[];
  maxRecommendations?: number;
  minDurationSec?: number;
  maxDurationSec?: number;
  customInstructions?: string;
  allowOverlap?: boolean;
  maxOverlapLayers?: number;
  transcriptSource?: "upload" | "premiere-markers";
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
  suggestedDurationSec?: number;
  suggestedLayerCount?: number;
  overlapStyle?: "single" | "parallel" | "staggered";
  timingRationale?: string;
  lowConfidenceReason?: string;
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
  ffmpegAvailable?: boolean;
  ffprobeAvailable?: boolean;
  customInstructions?: string;
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
