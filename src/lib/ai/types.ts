import { MediaType } from "../media";

export type AiMode = "off" | "local" | "hybrid";
export type EditorPacingPreset = "documentary" | "social-fast" | "cinematic-slow" | "tutorial";
export type CutBoundaryMode = "phrase" | "sentence" | "beat" | "ai";
export type MatchStyle = "literal" | "emotional" | "metaphorical" | "balanced";
export type AssetReusePolicy = "avoid-repeat" | "allow-small-folder-repeat" | "story-continuity";
export type VideoTrimPolicy = "full-clip" | "trim-to-beat" | "best-subspan";
export type AnalysisDepth = "fast" | "visual-frames" | "full-ai";
export type PlacementStrategyMode = "ai-dynamic" | "folder-order" | "hybrid-fallback";

export interface AiAssetCandidate {
  id: string;
  path: string;
  name: string;
  mediaType: MediaType;
  descriptor?: string;
  folderKeywords?: string[];
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
  roleTags?: Array<"hook" | "explanation" | "proof" | "transition" | "cta" | "general">;
  visualStyle?: "literal" | "metaphorical" | "background" | "overlay" | "texture" | "unknown";
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
  visualIntent: string;
  editorialRole: "hook" | "explanation" | "proof" | "transition" | "cta" | "general";
  visualMode: "literal" | "metaphorical" | "style" | "face-time";
  preferVideo: boolean;
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
  /** 0 = proportional beats only; 1 = strongest bounded jitter inside the transcript window. */
  variationStrength: number;
  minClipDurationSec: number;
  maxClipDurationSec: number;
  editGoal?: string;
  editStyle?: string;
  brollStyle?: string;
  captionStyle?: string;
  ctaContext?: string;
  creativeDirection?: string;
  brandNotes?: string;
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
  sourceDurationSec?: number;
  visualMatchReason?: string;
  lowConfidenceReason?: string;
  matchKind?: "literal" | "metaphorical" | "style" | "duration" | "fallback";
  mediaPreference?: MediaType | "either";
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
  editGoal?: string;
  editStyle?: string;
  brollStyle?: string;
  captionStyle?: string;
  ctaContext?: string;
  creativeDirection?: string;
  brandNotes?: string;
  fullScriptContext?: string;
}

export type MissingAssetType =
  | "image"
  | "video"
  | "background"
  | "overlay"
  | "texture"
  | "thumbnail"
  | "music"
  | "sfx"
  | "rotoscope";

export type MissingAssetToolCategory =
  | "image generator"
  | "video generator"
  | "music generator"
  | "SFX library"
  | "rotoscope tool";

export interface MissingAssetPrompt {
  id: string;
  segmentId: string;
  placementId: string;
  startSec: number;
  endSec: number;
  transcriptText: string;
  editorialRole: ScriptBeat["editorialRole"];
  visualIntent: string;
  visualMode: ScriptBeat["visualMode"];
  reason: string;
  suggestedAssetType: MissingAssetType;
  suggestedToolCategory: MissingAssetToolCategory;
  promptText: string;
  negativePrompt?: string;
  styleNotes: string;
  ctaContext?: string;
  brandNotes?: string;
  priority: "high" | "medium" | "low";
  status: "draft" | "copied" | "imported later";
  usage: "replace blank" | "replace fallback" | "enhance existing media";
  aiRefined?: boolean;
  refinementProvider?: string;
  refinementNote?: string;
  originalPromptText?: string;
  originalNegativePrompt?: string;
  originalStyleNotes?: string;
  originalReason?: string;
  originalUsage?: "replace blank" | "replace fallback" | "enhance existing media";
  refinedAt?: string;
}

export interface MissingAssetPlan {
  prompts: MissingAssetPrompt[];
  highPriorityCount: number;
  byType: Record<MissingAssetType, number>;
  generatedAt: string;
}

export interface ImportedGeneratedAsset {
  id: string;
  filePath: string;
  fileName: string;
  fileType: "image" | "video" | "audio" | "alpha" | "other";
  linkedPromptId: string;
  linkedPlacementId: string;
  linkedSegmentId: string;
  timestampStartSec: number;
  timestampEndSec: number;
  sourceTool: string;
  status: "imported" | "reviewed" | "approved" | "rejected";
  notes: string;
  importedAt: string;
  intendedUsage: MissingAssetPrompt["usage"];
  requestedAssetType: MissingAssetPrompt["suggestedAssetType"];
  replaceOrEnhance: MissingAssetPrompt["usage"];
  sourceDurationSec?: number;
  durationProbeStatus?: "not_probed" | "available" | "failed" | "unavailable";
  durationProbeNote?: string;
  visualSummary?: string;
  visualKeywords?: string[];
  visualStyle?: string[];
  moodTags?: string[];
  likelyUseCases?: string[];
  editorialRoleFit?: Array<"hook" | "explanation" | "proof" | "transition" | "cta" | "general">;
  matchKind?: "literal" | "metaphorical" | "background" | "overlay" | "texture" | "unknown";
  analysisStatus?: "not_analyzed" | "available" | "failed" | "unavailable";
  analysisProvider?: string;
  analysisNote?: string;
  analyzedAt?: string;
  }

export interface AssetInboxState {
    assets: ImportedGeneratedAsset[];
  }

export interface GeneratedAssetMatchSuggestion {
  id: string;
  placementId: string;
  generatedAssetId: string;
  startSec: number;
  endSec: number;
  transcriptText: string;
  confidence: number;
  matchReason: string;
  matchKind: "literal" | "metaphorical" | "background" | "overlay" | "texture" | "unknown";
  replaces: "blank" | "fallback" | "low-confidence" | "prompt-recommended" | "generated-ready";
  sourceTool: string;
  assetFileName: string;
  assetVisualSummary?: string;
  applyStatus: "suggested" | "applied" | "skipped";
}

export interface GeneratedAssetRerankResult {
  suggestions: GeneratedAssetMatchSuggestion[];
  highConfidenceCount: number;
  skippedCount: number;
  skippedReasons: string[];
  generatedAt: string;
}

export interface AgentHandoffPackage {
  packageVersion: "1.0";
  packageId: string;
  projectId?: string;
  sessionId?: string;
  createdAt: string;
  editRecipe: {
    editGoal: string;
    editStyle: string;
    brollStyle: string;
    captionStyle: string;
    ctaContext?: string;
    creativeDirection?: string;
    brandNotes?: string;
  };
  safetyNotes: string[];
  items: AgentHandoffItem[];
  resultContract: {
    packageVersion: "1.0";
    results: AgentGeneratedAssetResult[];
  };
}

export interface AgentHandoffItem {
  id: string;
  promptId: string;
  placementId: string;
  segmentId: string;
  startSec: number;
  endSec: number;
  transcriptText: string;
  priority: MissingAssetPrompt["priority"];
  assetType: MissingAssetPrompt["suggestedAssetType"];
  toolCategory: MissingAssetPrompt["suggestedToolCategory"];
  promptText: string;
  negativePrompt?: string;
  styleNotes: string;
  intendedUsage: MissingAssetPrompt["usage"];
  outputFolderSuggestion: string;
  aspectRatioSuggestion: string;
  durationSuggestionSec?: number;
  namingConvention: string;
  replaceOrEnhance: MissingAssetPrompt["usage"];
  linkedExistingAssetContext?: string[];
}

export interface AgentGeneratedAssetResult {
  promptId: string;
  placementId: string;
  filePath: string;
  sourceTool: string;
  assetType: "image" | "video" | "audio" | "alpha" | "other";
  status: "completed" | "failed" | "skipped";
  notes?: string;
  durationSec?: number;
  error?: string | null;
}

export interface AgentResultImportSummary {
  imported: number;
  skipped: number;
  errors: string[];
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
