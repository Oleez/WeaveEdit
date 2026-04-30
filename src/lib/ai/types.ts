import { MediaType } from "../media";

export type AiMode = "off" | "local" | "hybrid";
export type EditorPacingPreset = "documentary" | "social-fast" | "cinematic-slow" | "tutorial";
export type CutBoundaryMode = "phrase" | "sentence" | "beat" | "ai";
export type MatchStyle = "literal" | "emotional" | "metaphorical" | "balanced";
export type AssetReusePolicy = "avoid-repeat" | "allow-small-folder-repeat" | "story-continuity";
export type VideoTrimPolicy = "full-clip" | "trim-to-beat" | "best-subspan";
export type AnalysisDepth = "fast" | "visual-frames" | "full-ai";

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

export interface AssetSemanticProfile {
  id: string;
  path: string;
  name: string;
  mediaType: MediaType;
  candidate: AiAssetCandidate;
  caption: string;
  tags: string[];
  moodTags: string[];
  entities: string[];
  shotScale: "wide" | "medium" | "close" | "detail" | "unknown";
  motionEnergy: "static" | "gentle" | "active" | "high" | "unknown";
  useCases: string[];
  searchText: string;
  confidence: number;
  provider: string;
}

export interface ScriptBeat {
  id: string;
  segmentId: string;
  segmentIndex: number;
  beatIndex: number;
  startSec: number;
  endSec: number;
  text: string;
  boundary: CutBoundaryMode;
  emotionalTone: string;
  keywords: string[];
  pacing: "slow" | "medium" | "fast";
  matchStyle: MatchStyle;
  minDurationSec: number;
  maxDurationSec: number;
}

export interface DynamicEditorSettings {
  pacingPreset: EditorPacingPreset;
  cutBoundaryMode: CutBoundaryMode;
  matchStyle: MatchStyle;
  assetReusePolicy: AssetReusePolicy;
  videoTrimPolicy: VideoTrimPolicy;
  analysisDepth: AnalysisDepth;
  candidatePoolSize: number;
  rerankDepth: number;
  averageShotLengthSec: number;
  minClipDurationSec: number;
  maxClipDurationSec: number;
}

export interface DynamicAssignment {
  beat: ScriptBeat;
  profile: AssetSemanticProfile | null;
  score: number;
  rationale: string;
  reused: boolean;
}

export interface DynamicEditorResult {
  profiles: AssetSemanticProfile[];
  beats: ScriptBeat[];
  assignments: DynamicAssignment[];
  rankingsBySegmentId: Record<string, AiSegmentRanking>;
  metrics: {
    indexedAssets: number;
    profiledAssets: number;
    beatCount: number;
    assignedBeats: number;
    reusedAssignments: number;
  };
}

export interface AiSegmentRequest {
  segmentId: string;
  text: string;
  startSec: number;
  endSec: number | null;
  segmentIndex?: number;
  segmentTotal?: number;
  previousText?: string;
  nextText?: string;
  fullScriptContext?: string;
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
  suggestedClipCount?: number;
  overlapStyle?: "single" | "parallel" | "staggered";
  timingRationale?: string;
  coverageNotes?: string;
  reviewerNotes?: string[];
  lowConfidenceReason?: string;
  beatWindows?: AiBeatWindow[];
}

export interface AiBeatWindow {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
  emotionalTone?: string;
  pacing?: "slow" | "medium" | "fast";
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
  fullScriptContext?: string;
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
