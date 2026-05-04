import { ChangeEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  ExecuteTimelineJobInput,
  MediaScanResult,
  PremiereTranscriptSegment,
  PremiereRunResult,
  SilencePreviewResult,
  PremiereStatus,
  executeTimelineJob,
  executeSilenceCleanup,
  getEnvironmentVariable,
  getPremiereStatus,
  getPremiereTranscriptSegments,
  hasNativeFolderPicker,
  isCepEnvironment,
  isNodeEnabled,
  listMediaFiles,
  pickFolder,
  previewSilenceCleanup,
} from "@/lib/cep";
import { detectVideoTooling, indexMediaLibraryForAi, probeVideoDuration } from "@/lib/ai/video-preprocessing";
import { checkAiProviders, profileAssetsWithAi } from "@/lib/ai/router";
import {
  buildMissingAssetPlan,
  formatMissingAssetPlanMarkdown,
  formatMissingAssetPrompt,
} from "@/lib/ai/missing-asset-plan";
import {
  AppliedGeneratedAssetMap,
  GeneratedAssetApplySummary,
  applyGeneratedAssetsToPlacements,
  buildApprovedGeneratedAssetMap,
} from "@/lib/ai/generated-asset-planner";
import {
  AssetAttachDraft,
  createImportedGeneratedAsset,
  formatAssetInboxCsv,
} from "@/lib/ai/asset-inbox";
import {
  PromptPlanRefinementResult,
  refineMissingAssetPlanWithAi,
  resetPromptRefinement,
} from "@/lib/ai/prompt-plan-refiner";
import {
  DEFAULT_DYNAMIC_EDITOR_SETTINGS,
  buildDynamicEditorResult,
  createFallbackAssetProfile,
} from "@/lib/ai/dynamic-editor";
import {
  AnalysisDepth,
  AssetReusePolicy,
  CutBoundaryMode,
  AiHealthStatus,
  AiMode,
  AiScoringContext,
  AiSegmentRanking,
  DynamicEditorSettings,
  EditorPacingPreset,
  ImportedGeneratedAsset,
  MatchStyle,
  MissingAssetPlan,
  PlacementStrategyMode,
  VideoTrimPolicy,
} from "@/lib/ai/types";
import { ScriptSegment, formatSeconds, parseTimestampScript } from "@/lib/script-parser";
import {
  TimelineCoverageSummary,
  TimelinePlacement,
  buildTimelinePlan,
  resolveTimelineCoverage,
} from "@/lib/timeline-plan";
import { MediaLibraryItem, MediaLibraryMode, MediaSortMode, getFileName, normalizePath } from "@/lib/media";

const STORAGE_KEY = "weave-edit-settings";
const LEGACY_STORAGE_KEY = "sora-genie-settings";
const statusPillBase =
  "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]";

type EditGoal =
  | "views-retention"
  | "leads-webinar"
  | "sales-product"
  | "authority-personal-brand"
  | "education-tutorial"
  | "clean-client-delivery";
type EditStyle =
  | "premium-business"
  | "fast-viral"
  | "clean-podcast"
  | "luxury-minimal"
  | "ugc-ad"
  | "cinematic-documentary"
  | "high-energy-shorts";
type BrollStyle =
  | "literal"
  | "metaphorical"
  | "mixed"
  | "minimal-face-time"
  | "stock-footage-heavy"
  | "generated-asset-ready";
type CaptionStyle =
  | "clean-bold"
  | "hormozi-punchy"
  | "minimal-premium"
  | "documentary-lower-third"
  | "ugc-native";

const EDIT_GOAL_OPTIONS: Array<{ value: EditGoal; label: string }> = [
  { value: "views-retention", label: "Views / Retention" },
  { value: "leads-webinar", label: "Leads / Webinar" },
  { value: "sales-product", label: "Sales / Product" },
  { value: "authority-personal-brand", label: "Authority / Personal Brand" },
  { value: "education-tutorial", label: "Education / Tutorial" },
  { value: "clean-client-delivery", label: "Clean Client Delivery" },
];

const EDIT_STYLE_OPTIONS: Array<{ value: EditStyle; label: string }> = [
  { value: "premium-business", label: "Premium Business" },
  { value: "fast-viral", label: "Fast Viral" },
  { value: "clean-podcast", label: "Clean Podcast" },
  { value: "luxury-minimal", label: "Luxury Minimal" },
  { value: "ugc-ad", label: "UGC Ad" },
  { value: "cinematic-documentary", label: "Cinematic Documentary" },
  { value: "high-energy-shorts", label: "High-Energy Shorts" },
];

const BROLL_STYLE_OPTIONS: Array<{ value: BrollStyle; label: string }> = [
  { value: "literal", label: "Literal" },
  { value: "metaphorical", label: "Metaphorical" },
  { value: "mixed", label: "Mixed" },
  { value: "minimal-face-time", label: "Minimal / Face-Time Heavy" },
  { value: "stock-footage-heavy", label: "Stock Footage Heavy" },
  { value: "generated-asset-ready", label: "Generated Asset Ready" },
];

const CAPTION_STYLE_OPTIONS: Array<{ value: CaptionStyle; label: string }> = [
  { value: "clean-bold", label: "Clean Bold" },
  { value: "hormozi-punchy", label: "Hormozi-Style Punchy" },
  { value: "minimal-premium", label: "Minimal Premium" },
  { value: "documentary-lower-third", label: "Documentary Lower Third" },
  { value: "ugc-native", label: "UGC Native" },
];

interface StoredSettings {
  scriptText: string;
  imageFolderPath: string;
  libraryMode: MediaLibraryMode;
  transcriptSourceMode: "upload" | "premiere-markers";
  mediaSortMode: MediaSortMode;
  placementStrategyMode: PlacementStrategyMode;
  editGoal: EditGoal;
  editStyle: EditStyle;
  brollStyle: BrollStyle;
  captionStyle: CaptionStyle;
  ctaContext: string;
  creativeDirection: string;
  brandNotes: string;
  generatedAssets: ImportedGeneratedAsset[];
  customInstructions: string;
  minDurationSec: number;
  maxDurationSec: number;
  targetVideoTrack: number;
  appendAtTrackEnd: boolean;
  useWholeSequenceFallback: boolean;
  aiMode: AiMode;
  ollamaBaseUrl: string;
  ollamaModel: string;
  geminiModel: string;
  aiConfidenceThreshold: number;
  pacingPreset: EditorPacingPreset;
  cutBoundaryMode: CutBoundaryMode;
  matchStyle: MatchStyle;
  assetReusePolicy: AssetReusePolicy;
  videoTrimPolicy: VideoTrimPolicy;
  analysisDepth: AnalysisDepth;
  candidatePoolSize: number;
  rerankDepth: number;
  averageShotLengthSec: number;
  variationStrength: number;
  silenceThresholdDb: number;
  minSilenceSec: number;
  keepSilenceSec: number;
  targetAudioTrack: number;
}

interface WorkingPlan {
  mode: "append" | "sequence_in_out" | "whole_sequence" | "missing_range";
  placements: TimelinePlacement[];
  skippedCount: number;
  clippedCount: number;
  rangeStartSec: number;
  rangeEndSec: number;
  coverage: TimelineCoverageSummary;
}

const defaultSettings: StoredSettings = {
  scriptText: "",
  imageFolderPath: "",
  libraryMode: "images",
  transcriptSourceMode: "premiere-markers",
  mediaSortMode: "downloaded-oldest",
  placementStrategyMode: "folder-order",
  editGoal: "views-retention",
  editStyle: "premium-business",
  brollStyle: "mixed",
  captionStyle: "clean-bold",
  ctaContext: "",
  creativeDirection: "Make the edit polished, useful, and retention-focused without random B-roll.",
  brandNotes: "",
  generatedAssets: [],
  customInstructions: "",
  minDurationSec: 2,
  maxDurationSec: 8,
  targetVideoTrack: 2,
  appendAtTrackEnd: false,
  useWholeSequenceFallback: false,
  aiMode: "off",
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModel: "gemma4:e4b",
  geminiModel: "gemma-4-26b-a4b-it",
  aiConfidenceThreshold: 0.42,
  pacingPreset: DEFAULT_DYNAMIC_EDITOR_SETTINGS.pacingPreset,
  cutBoundaryMode: DEFAULT_DYNAMIC_EDITOR_SETTINGS.cutBoundaryMode,
  matchStyle: DEFAULT_DYNAMIC_EDITOR_SETTINGS.matchStyle,
  assetReusePolicy: DEFAULT_DYNAMIC_EDITOR_SETTINGS.assetReusePolicy,
  videoTrimPolicy: DEFAULT_DYNAMIC_EDITOR_SETTINGS.videoTrimPolicy,
  analysisDepth: DEFAULT_DYNAMIC_EDITOR_SETTINGS.analysisDepth,
  candidatePoolSize: DEFAULT_DYNAMIC_EDITOR_SETTINGS.candidatePoolSize,
  rerankDepth: DEFAULT_DYNAMIC_EDITOR_SETTINGS.rerankDepth,
  averageShotLengthSec: DEFAULT_DYNAMIC_EDITOR_SETTINGS.averageShotLengthSec,
  variationStrength: DEFAULT_DYNAMIC_EDITOR_SETTINGS.variationStrength,
  silenceThresholdDb: -45,
  minSilenceSec: 0.35,
  keepSilenceSec: 0.05,
  targetAudioTrack: 1,
};

const Index = () => {
  const [scriptText, setScriptText] = useState(defaultSettings.scriptText);
  const [scriptSourceName, setScriptSourceName] = useState("Paste script or load a file");
  const [imageFolderPath, setImageFolderPath] = useState(defaultSettings.imageFolderPath);
  const [libraryMode, setLibraryMode] = useState<MediaLibraryMode>(defaultSettings.libraryMode);
  const [transcriptSourceMode, setTranscriptSourceMode] = useState<"upload" | "premiere-markers">(
    defaultSettings.transcriptSourceMode,
  );
  const [mediaSortMode, setMediaSortMode] = useState<MediaSortMode>(defaultSettings.mediaSortMode);
  const [placementStrategyMode, setPlacementStrategyMode] = useState<PlacementStrategyMode>(
    defaultSettings.placementStrategyMode,
  );
  const [editGoal, setEditGoal] = useState<EditGoal>(defaultSettings.editGoal);
  const [editStyle, setEditStyle] = useState<EditStyle>(defaultSettings.editStyle);
  const [brollStyle, setBrollStyle] = useState<BrollStyle>(defaultSettings.brollStyle);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(defaultSettings.captionStyle);
  const [ctaContext, setCtaContext] = useState(defaultSettings.ctaContext);
  const [creativeDirection, setCreativeDirection] = useState(defaultSettings.creativeDirection);
  const [brandNotes, setBrandNotes] = useState(defaultSettings.brandNotes);
  const [customInstructions, setCustomInstructions] = useState(defaultSettings.customInstructions);
  const [mediaItems, setMediaItems] = useState<MediaLibraryItem[]>([]);
  const [scanWarnings, setScanWarnings] = useState<string[]>([]);
  const [minDurationSec, setMinDurationSec] = useState(defaultSettings.minDurationSec);
  const [maxDurationSec, setMaxDurationSec] = useState(defaultSettings.maxDurationSec);
  const [targetVideoTrack, setTargetVideoTrack] = useState(defaultSettings.targetVideoTrack);
  const [appendAtTrackEnd, setAppendAtTrackEnd] = useState(defaultSettings.appendAtTrackEnd);
  const [useWholeSequenceFallback, setUseWholeSequenceFallback] = useState(
    defaultSettings.useWholeSequenceFallback,
  );
  const [aiMode, setAiMode] = useState<AiMode>(defaultSettings.aiMode);
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(defaultSettings.ollamaBaseUrl);
  const [ollamaModel, setOllamaModel] = useState(defaultSettings.ollamaModel);
  const [geminiModel, setGeminiModel] = useState(defaultSettings.geminiModel);
  const [aiConfidenceThreshold, setAiConfidenceThreshold] = useState(
    defaultSettings.aiConfidenceThreshold,
  );
  const [pacingPreset, setPacingPreset] = useState<EditorPacingPreset>(defaultSettings.pacingPreset);
  const [cutBoundaryMode, setCutBoundaryMode] = useState<CutBoundaryMode>(defaultSettings.cutBoundaryMode);
  const [matchStyle, setMatchStyle] = useState<MatchStyle>(defaultSettings.matchStyle);
  const [assetReusePolicy, setAssetReusePolicy] = useState<AssetReusePolicy>(defaultSettings.assetReusePolicy);
  const [videoTrimPolicy, setVideoTrimPolicy] = useState<VideoTrimPolicy>(defaultSettings.videoTrimPolicy);
  const [analysisDepth, setAnalysisDepth] = useState<AnalysisDepth>(defaultSettings.analysisDepth);
  const [candidatePoolSize, setCandidatePoolSize] = useState(defaultSettings.candidatePoolSize);
  const [rerankDepth, setRerankDepth] = useState(defaultSettings.rerankDepth);
  const [averageShotLengthSec, setAverageShotLengthSec] = useState(defaultSettings.averageShotLengthSec);
  const [variationStrength, setVariationStrength] = useState(defaultSettings.variationStrength);
  const [silenceThresholdDb, setSilenceThresholdDb] = useState(defaultSettings.silenceThresholdDb);
  const [minSilenceSec, setMinSilenceSec] = useState(defaultSettings.minSilenceSec);
  const [keepSilenceSec, setKeepSilenceSec] = useState(defaultSettings.keepSilenceSec);
  const [targetAudioTrack, setTargetAudioTrack] = useState(defaultSettings.targetAudioTrack);
  const [hostStatus, setHostStatus] = useState<PremiereStatus | null>(null);
  const [result, setResult] = useState<PremiereRunResult | null>(null);
  const [silencePreview, setSilencePreview] = useState<SilencePreviewResult | null>(null);
  const [silenceBusyMessage, setSilenceBusyMessage] = useState<string | null>(null);
  const [showAdvancedUi, setShowAdvancedUi] = useState(false);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [aiBusyMessage, setAiBusyMessage] = useState<string | null>(null);
  const [aiHealth, setAiHealth] = useState<AiHealthStatus[]>([]);
  const [aiErrors, setAiErrors] = useState<string[]>([]);
  const [aiCacheHits, setAiCacheHits] = useState(0);
  const [dynamicMetrics, setDynamicMetrics] = useState({
    indexedAssets: 0,
    profiledAssets: 0,
    beatCount: 0,
    assignedBeats: 0,
    reusedAssignments: 0,
  });
  const [aiRankingsBySegmentId, setAiRankingsBySegmentId] = useState<
    Record<string, AiSegmentRanking>
  >({});
  const [manualOverridesBySegmentId, setManualOverridesBySegmentId] = useState<
    Record<string, string | "blank" | "auto">
  >({});
  const [copiedPromptIds, setCopiedPromptIds] = useState<Record<string, boolean>>({});
  const [refinedMissingAssetPlan, setRefinedMissingAssetPlan] = useState<MissingAssetPlan | null>(null);
  const [promptRefineBusyMessage, setPromptRefineBusyMessage] = useState<string | null>(null);
  const [promptRefinementResult, setPromptRefinementResult] = useState<PromptPlanRefinementResult | null>(null);
  const [generatedAssets, setGeneratedAssets] = useState<ImportedGeneratedAsset[]>(defaultSettings.generatedAssets);
  const [activeAttachPromptId, setActiveAttachPromptId] = useState<string | null>(null);
  const [assetDraftsByPromptId, setAssetDraftsByPromptId] = useState<Record<string, AssetAttachDraft>>({});
  const [assetStatusFilter, setAssetStatusFilter] = useState<"all" | ImportedGeneratedAsset["status"]>("all");
  const [assetTypeFilter, setAssetTypeFilter] = useState<"all" | ImportedGeneratedAsset["fileType"]>("all");
  const [appliedGeneratedAssetIdsByPlacementId, setAppliedGeneratedAssetIdsByPlacementId] =
    useState<AppliedGeneratedAssetMap>({});
  const [generatedAssetApplySummary, setGeneratedAssetApplySummary] =
    useState<GeneratedAssetApplySummary | null>(null);

  const dynamicEditorSettings = useMemo<DynamicEditorSettings>(
    () => ({
      pacingPreset,
      cutBoundaryMode,
      matchStyle,
      assetReusePolicy,
      videoTrimPolicy,
      analysisDepth,
      candidatePoolSize: Math.max(10, Math.round(candidatePoolSize)),
      rerankDepth: Math.max(3, Math.round(rerankDepth)),
      averageShotLengthSec: clampDurationInput(averageShotLengthSec, 1),
      variationStrength: clampVariationStrength(variationStrength),
      minClipDurationSec: Math.max(0.5, Math.min(minDurationSec, maxDurationSec)),
      maxClipDurationSec: Math.max(minDurationSec, maxDurationSec),
      editGoal: getOptionLabel(EDIT_GOAL_OPTIONS, editGoal),
      editStyle: getOptionLabel(EDIT_STYLE_OPTIONS, editStyle),
      brollStyle: getOptionLabel(BROLL_STYLE_OPTIONS, brollStyle),
      captionStyle: getOptionLabel(CAPTION_STYLE_OPTIONS, captionStyle),
      ctaContext,
      creativeDirection,
      brandNotes,
    }),
    [
      analysisDepth,
      assetReusePolicy,
      averageShotLengthSec,
      brandNotes,
      brollStyle,
      variationStrength,
      candidatePoolSize,
      captionStyle,
      creativeDirection,
      ctaContext,
      cutBoundaryMode,
      editGoal,
      editStyle,
      matchStyle,
      maxDurationSec,
      minDurationSec,
      pacingPreset,
      rerankDepth,
      videoTrimPolicy,
    ],
  );

  const refreshPremiereStatus = useCallback(async () => {
    setBusyMessage("Checking Premiere sequence");

    try {
      const nextStatus = await getPremiereStatus();
      setHostStatus(nextStatus);

      if (nextStatus.ok && targetVideoTrack > nextStatus.videoTracks.length) {
        setTargetVideoTrack(Math.max(1, nextStatus.videoTracks.length));
      }
    } catch (error) {
      setHostStatus({
        ok: false,
        connected: true,
        projectName: "",
        sequenceName: "",
        videoTracks: [],
        frameRate: 30,
        range: {
          inSec: 0,
          outSec: 0,
          sequenceEndSec: 0,
          hasMeaningfulInOut: false,
        },
        message: String(error),
      });
    } finally {
      setBusyMessage(null);
    }
  }, [targetVideoTrack]);

  const applyScanResult = useCallback((scanResult: MediaScanResult) => {
    setMediaItems(scanResult.items);
    setScanWarnings(scanResult.warnings);
    setFolderError(
      scanResult.items.length > 0
        ? null
        : libraryMode === "images"
          ? "The selected folder does not contain supported image files."
          : libraryMode === "videos"
            ? "The selected folder does not contain supported video files."
            : "The selected folder does not contain supported image or video files.",
    );
    setResult(null);
  }, [libraryMode]);

  useEffect(() => {
    const stored = loadStoredSettings();
    if (!stored) {
      return;
    }

    setScriptText(stored.scriptText ?? defaultSettings.scriptText);
    setImageFolderPath(stored.imageFolderPath ?? defaultSettings.imageFolderPath);
    setLibraryMode(stored.libraryMode ?? defaultSettings.libraryMode);
    setTranscriptSourceMode(stored.transcriptSourceMode ?? defaultSettings.transcriptSourceMode);
    setMediaSortMode(stored.mediaSortMode ?? defaultSettings.mediaSortMode);
    setPlacementStrategyMode(stored.placementStrategyMode ?? defaultSettings.placementStrategyMode);
    setEditGoal(stored.editGoal ?? defaultSettings.editGoal);
    setEditStyle(stored.editStyle ?? defaultSettings.editStyle);
    setBrollStyle(stored.brollStyle ?? defaultSettings.brollStyle);
    setCaptionStyle(stored.captionStyle ?? defaultSettings.captionStyle);
    setCtaContext(stored.ctaContext ?? defaultSettings.ctaContext);
    setCreativeDirection(stored.creativeDirection ?? defaultSettings.creativeDirection);
    setBrandNotes(stored.brandNotes ?? defaultSettings.brandNotes);
    setGeneratedAssets(stored.generatedAssets ?? defaultSettings.generatedAssets);
    setCustomInstructions(stored.customInstructions ?? defaultSettings.customInstructions);
    setMinDurationSec(clampDurationInput(stored.minDurationSec ?? defaultSettings.minDurationSec, 0.5));
    setMaxDurationSec(clampDurationInput(stored.maxDurationSec ?? defaultSettings.maxDurationSec, 0.5));
    setTargetVideoTrack(stored.targetVideoTrack ?? defaultSettings.targetVideoTrack);
    setAppendAtTrackEnd(stored.appendAtTrackEnd ?? defaultSettings.appendAtTrackEnd);
    setUseWholeSequenceFallback(
      stored.useWholeSequenceFallback ?? defaultSettings.useWholeSequenceFallback,
    );
    setAiMode(stored.aiMode ?? defaultSettings.aiMode);
    setOllamaBaseUrl(stored.ollamaBaseUrl ?? defaultSettings.ollamaBaseUrl);
    setOllamaModel(stored.ollamaModel ?? defaultSettings.ollamaModel);
    setGeminiModel(stored.geminiModel ?? defaultSettings.geminiModel);
    setAiConfidenceThreshold(
      stored.aiConfidenceThreshold ?? defaultSettings.aiConfidenceThreshold,
    );
    setPacingPreset(stored.pacingPreset ?? defaultSettings.pacingPreset);
    setCutBoundaryMode(stored.cutBoundaryMode ?? defaultSettings.cutBoundaryMode);
    setMatchStyle(stored.matchStyle ?? defaultSettings.matchStyle);
    setAssetReusePolicy(stored.assetReusePolicy ?? defaultSettings.assetReusePolicy);
    setVideoTrimPolicy(stored.videoTrimPolicy ?? defaultSettings.videoTrimPolicy);
    setAnalysisDepth(stored.analysisDepth ?? defaultSettings.analysisDepth);
    setCandidatePoolSize(stored.candidatePoolSize ?? defaultSettings.candidatePoolSize);
    setRerankDepth(stored.rerankDepth ?? defaultSettings.rerankDepth);
    setAverageShotLengthSec(clampDurationInput(stored.averageShotLengthSec ?? defaultSettings.averageShotLengthSec, 1));
    setVariationStrength(clampVariationStrength(stored.variationStrength ?? defaultSettings.variationStrength));
    setSilenceThresholdDb(stored.silenceThresholdDb ?? defaultSettings.silenceThresholdDb);
    setMinSilenceSec(clampDurationInput(stored.minSilenceSec ?? defaultSettings.minSilenceSec, 0.05));
    setKeepSilenceSec(clampDurationInput(stored.keepSilenceSec ?? defaultSettings.keepSilenceSec, 0));
    setTargetAudioTrack(stored.targetAudioTrack ?? defaultSettings.targetAudioTrack);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        scriptText,
        imageFolderPath,
        libraryMode,
        transcriptSourceMode,
        mediaSortMode,
        placementStrategyMode,
        editGoal,
        editStyle,
        brollStyle,
        captionStyle,
        ctaContext,
        creativeDirection,
        brandNotes,
        generatedAssets,
        customInstructions,
        minDurationSec,
        maxDurationSec,
        targetVideoTrack,
        appendAtTrackEnd,
        useWholeSequenceFallback,
        aiMode,
        ollamaBaseUrl,
        ollamaModel,
        geminiModel,
        aiConfidenceThreshold,
        pacingPreset,
        cutBoundaryMode,
        matchStyle,
        assetReusePolicy,
        videoTrimPolicy,
        analysisDepth,
        candidatePoolSize,
        rerankDepth,
        averageShotLengthSec,
        variationStrength,
        silenceThresholdDb,
        minSilenceSec,
        keepSilenceSec,
        targetAudioTrack,
      } satisfies StoredSettings),
    );
  }, [
    appendAtTrackEnd,
    imageFolderPath,
    libraryMode,
    transcriptSourceMode,
    mediaSortMode,
    placementStrategyMode,
    editGoal,
    editStyle,
    brollStyle,
    captionStyle,
    ctaContext,
    creativeDirection,
    brandNotes,
    generatedAssets,
    customInstructions,
    maxDurationSec,
    minDurationSec,
    scriptText,
    targetVideoTrack,
    useWholeSequenceFallback,
    aiMode,
    ollamaBaseUrl,
    ollamaModel,
    geminiModel,
    aiConfidenceThreshold,
    pacingPreset,
    cutBoundaryMode,
    matchStyle,
    assetReusePolicy,
    videoTrimPolicy,
    analysisDepth,
    candidatePoolSize,
    rerankDepth,
    averageShotLengthSec,
    variationStrength,
    silenceThresholdDb,
    minSilenceSec,
    keepSilenceSec,
    targetAudioTrack,
  ]);

  useEffect(() => {
    if (!imageFolderPath || !isNodeEnabled()) {
      return;
    }

    applyScanResult(scanLibraryFolder(imageFolderPath, libraryMode, mediaSortMode));
  }, [applyScanResult, imageFolderPath, libraryMode, mediaSortMode]);

  useEffect(() => {
    setAiRankingsBySegmentId({});
    setManualOverridesBySegmentId({});
    setAiErrors([]);
  }, [
    scriptText,
    imageFolderPath,
    customInstructions,
    editGoal,
    editStyle,
    brollStyle,
    captionStyle,
    ctaContext,
    creativeDirection,
    brandNotes,
    placementStrategyMode,
    mediaSortMode,
  ]);

  const parsedScriptState = useMemo(() => {
    if (!scriptText.trim()) {
      return { error: null, result: null };
    }

    try {
      return {
        error: null,
        result: parseTimestampScript(scriptText, { fps: hostStatus?.frameRate }),
      };
    } catch (error) {
      return { error: String(error), result: null };
    }
  }, [hostStatus?.frameRate, scriptText]);

  const basePlan = useMemo(() => {
    if (!parsedScriptState.result || mediaItems.length === 0) {
      return null;
    }

    return buildTimelinePlan(parsedScriptState.result.segments, mediaItems, {
      minDurationSec: Math.max(0.5, Math.min(minDurationSec, maxDurationSec)),
      maxDurationSec: Math.max(minDurationSec, maxDurationSec),
      blankWhenNoImage: true,
      aiRankingsBySegmentId,
      manualOverridesBySegmentId,
      aiConfidenceThreshold,
      allowLowConfidenceFallback: true,
      maxOverlapLayers: dynamicEditorSettings.pacingPreset === "cinematic-slow" ? 1 : 2,
      frameRate: hostStatus?.frameRate ?? 30,
      sequenceEndSec: hostStatus?.range.sequenceEndSec,
      targetSecondsPerClip: dynamicEditorSettings.averageShotLengthSec,
      placementStrategyMode,
      variationStrength: dynamicEditorSettings.variationStrength,
      editorPacingPreset: pacingPreset,
    });
  }, [
    aiConfidenceThreshold,
    aiRankingsBySegmentId,
    dynamicEditorSettings,
    hostStatus?.frameRate,
    hostStatus?.range.sequenceEndSec,
    mediaItems,
    manualOverridesBySegmentId,
    maxDurationSec,
    minDurationSec,
    parsedScriptState.result,
    placementStrategyMode,
    pacingPreset,
  ]);

  const effectivePlan = useMemo<WorkingPlan | null>(() => {
    if (!basePlan) {
      return null;
    }

    if (appendAtTrackEnd) {
      return {
        mode: "append",
        placements: basePlan.placements,
        skippedCount: 0,
        clippedCount: 0,
        rangeStartSec: 0,
        rangeEndSec: 0,
        coverage: basePlan.coverage,
      };
    }

    const range = hostStatus?.range;
    if (range?.hasMeaningfulInOut) {
      const clipped = applyWorkingRange(basePlan.placements, range.inSec, range.outSec);
      const resolved = resolveTimelineCoverage(clipped.placements, {
        minDurationSec: Math.max(0.5, Math.min(minDurationSec, maxDurationSec)),
        maxDurationSec: Math.max(minDurationSec, maxDurationSec),
        frameRate: hostStatus?.frameRate ?? 30,
        rangeStartSec: range.inSec,
        rangeEndSec: range.outSec,
        targetSecondsPerClip: dynamicEditorSettings.averageShotLengthSec,
        variationStrength: dynamicEditorSettings.variationStrength,
        editorPacingPreset: pacingPreset,
      });
      return {
        mode: "sequence_in_out",
        placements: resolved.placements,
        skippedCount: clipped.skippedCount,
        clippedCount: clipped.clippedCount + resolved.summary.adjustedPlacementCount,
        rangeStartSec: range.inSec,
        rangeEndSec: range.outSec,
        coverage: {
          ...resolved.summary,
          reusedAssetPlacements: basePlan.coverage.reusedAssetPlacements,
        },
      };
    }

    if (useWholeSequenceFallback || !hostStatus?.ok) {
      return {
        mode: "whole_sequence",
        placements: basePlan.placements,
        skippedCount: 0,
        clippedCount: 0,
        rangeStartSec: 0,
        rangeEndSec: hostStatus?.range.sequenceEndSec ?? 0,
        coverage: basePlan.coverage,
      };
    }

    return {
      mode: "missing_range",
      placements: basePlan.placements,
      skippedCount: 0,
      clippedCount: 0,
      rangeStartSec: 0,
      rangeEndSec: hostStatus?.range.sequenceEndSec ?? 0,
      coverage: basePlan.coverage,
    };
  }, [
    appendAtTrackEnd,
    basePlan,
    dynamicEditorSettings.averageShotLengthSec,
    dynamicEditorSettings.variationStrength,
    hostStatus,
    maxDurationSec,
    minDurationSec,
    pacingPreset,
    useWholeSequenceFallback,
  ]);

  const baseMissingAssetPlan = useMemo(
    () =>
      buildMissingAssetPlan(
        effectivePlan?.placements ?? [],
        dynamicEditorSettings,
      ),
    [dynamicEditorSettings, effectivePlan],
  );

  const missingAssetPlan = refinedMissingAssetPlan ?? baseMissingAssetPlan;
  const promptRecommendedPlacementIds = useMemo(
    () => new Set(missingAssetPlan.prompts.map((prompt) => prompt.placementId)),
    [missingAssetPlan],
  );

  const generatedAssetPlanResult = useMemo(
    () =>
      effectivePlan
        ? applyGeneratedAssetsToPlacements({
            placements: effectivePlan.placements,
            assets: generatedAssets,
            appliedAssetIdsByPlacementId: appliedGeneratedAssetIdsByPlacementId,
            fileExists: generatedAssetPathExists,
            promptRecommendedPlacementIds,
          })
        : null,
    [appliedGeneratedAssetIdsByPlacementId, effectivePlan, generatedAssets, promptRecommendedPlacementIds],
  );

  const previewPlan = useMemo<WorkingPlan | null>(
    () =>
      effectivePlan && generatedAssetPlanResult
        ? {
            ...effectivePlan,
            placements: generatedAssetPlanResult.placements,
          }
        : effectivePlan,
    [effectivePlan, generatedAssetPlanResult],
  );

  const previewStats = useMemo(() => {
    const placements = previewPlan?.placements ?? [];

    return placements.reduce(
      (summary, placement) => {
        if (placement.strategy === "ai") {
          summary.ai += 1;
        } else if (placement.strategy === "fallback") {
          summary.fallback += 1;
        } else if (placement.strategy === "manual") {
          summary.manual += 1;
        } else if (placement.strategy === "generated") {
          summary.generated += 1;
        } else {
          summary.blank += 1;
        }

        if (placement.layerIndex > 0) {
          summary.overlap += 1;
        }

        return summary;
      },
      { ai: 0, fallback: 0, manual: 0, generated: 0, overlap: 0, blank: 0 },
    );
  }, [previewPlan]);

  const promptByPlacementId = useMemo(
    () =>
      new Map(
        missingAssetPlan.prompts.map((prompt) => [prompt.placementId, prompt]),
      ),
    [missingAssetPlan],
  );

  const assetsByPromptId = useMemo(() => {
    const grouped = new Map<string, ImportedGeneratedAsset[]>();
    generatedAssets.forEach((asset) => {
      grouped.set(asset.linkedPromptId, [...(grouped.get(asset.linkedPromptId) ?? []), asset]);
    });
    return grouped;
  }, [generatedAssets]);

  const assetsByPlacementId = useMemo(() => {
    const grouped = new Map<string, ImportedGeneratedAsset[]>();
    generatedAssets.forEach((asset) => {
      grouped.set(asset.linkedPlacementId, [...(grouped.get(asset.linkedPlacementId) ?? []), asset]);
    });
    return grouped;
  }, [generatedAssets]);

  const filteredGeneratedAssets = useMemo(
    () =>
      generatedAssets.filter(
        (asset) =>
          (assetStatusFilter === "all" || asset.status === assetStatusFilter) &&
          (assetTypeFilter === "all" || asset.fileType === assetTypeFilter),
      ),
    [assetStatusFilter, assetTypeFilter, generatedAssets],
  );

  useEffect(() => {
    setRefinedMissingAssetPlan(null);
    setPromptRefinementResult(null);
    setCopiedPromptIds({});
  }, [baseMissingAssetPlan]);

  useEffect(() => {
    if (!effectivePlan) {
      setAppliedGeneratedAssetIdsByPlacementId({});
      setGeneratedAssetApplySummary(null);
      return;
    }

    const placementIds = new Set(effectivePlan.placements.map((placement) => placement.id));
    setAppliedGeneratedAssetIdsByPlacementId((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([placementId]) => placementIds.has(placementId)),
      ),
    );
  }, [effectivePlan]);

  const libraryStats = useMemo(
    () => ({
      images: mediaItems.filter((item) => item.type === "image").length,
      videos: mediaItems.filter((item) => item.type === "video").length,
    }),
    [mediaItems],
  );

  const executeReason = useMemo(() => {
    if (!hostStatus) {
      return "Click Refresh in Premiere status after the panel opens.";
    }

    if (!hostStatus?.ok) {
      return "Open a Premiere project and activate a sequence first.";
    }

    if (!basePlan || basePlan.placements.length === 0) {
      return "Add a valid timestamped script and media folder first.";
    }

    if (!previewPlan || previewPlan.placements.length === 0) {
      return "No placements fall inside the current working range.";
    }

    if (previewPlan.mode === "missing_range") {
      return "Set sequence In/Out marks or enable whole-sequence fallback.";
    }

    return null;
  }, [basePlan, hostStatus, previewPlan]);

  const canExecute = !busyMessage && !executeReason;
  const hasMeaningfulInOut = Boolean(hostStatus?.range.hasMeaningfulInOut);
  const geminiApiKey = getEnvironmentVariable("GEMINI_API_KEY");
  const videoTooling = useMemo(() => detectVideoTooling(), []);
  const canChooseFolder = hasNativeFolderPicker();
  const aiContext = useMemo<AiScoringContext>(
    () => ({
      ollamaBaseUrl,
      ollamaModel,
      geminiModel,
      geminiApiKey,
      timeoutMs: 15000,
      ffmpegAvailable: videoTooling.ffmpegAvailable,
      ffprobeAvailable: videoTooling.ffprobeAvailable,
      customInstructions,
      editGoal: getOptionLabel(EDIT_GOAL_OPTIONS, editGoal),
      editStyle: getOptionLabel(EDIT_STYLE_OPTIONS, editStyle),
      brollStyle: getOptionLabel(BROLL_STYLE_OPTIONS, brollStyle),
      captionStyle: getOptionLabel(CAPTION_STYLE_OPTIONS, captionStyle),
      ctaContext,
      creativeDirection,
      brandNotes,
      fullScriptContext: parsedScriptState.result ? buildFullScriptContext(parsedScriptState.result.segments) : undefined,
    }),
    [
      brandNotes,
      brollStyle,
      captionStyle,
      creativeDirection,
      ctaContext,
      customInstructions,
      editGoal,
      editStyle,
      geminiApiKey,
      geminiModel,
      ollamaBaseUrl,
      ollamaModel,
      parsedScriptState.result,
      videoTooling,
    ],
  );

  async function runAiHealthCheck() {
    if (aiMode === "off") {
      setAiHealth([]);
      return;
    }

    setAiBusyMessage("Checking AI providers");
    try {
      const statuses = await checkAiProviders(aiMode, aiContext);
      setAiHealth(statuses);
    } catch (error) {
      setAiErrors([String(error)]);
    } finally {
      setAiBusyMessage(null);
    }
  }

  async function runAiRanking() {
    if (
      aiMode === "off" ||
      placementStrategyMode === "folder-order" ||
      !parsedScriptState.result ||
      mediaItems.length === 0
    ) {
      return;
    }

    setAiBusyMessage("Indexing full media library");
    setAiErrors([]);
    setAiCacheHits(0);
    setDynamicMetrics({
      indexedAssets: 0,
      profiledAssets: 0,
      beatCount: 0,
      assignedBeats: 0,
      reusedAssignments: 0,
    });

    try {
      const segments = parsedScriptState.result.segments;
      const fullScriptContext = buildFullScriptContext(segments);
      if (!fullScriptContext.trim()) {
        setAiErrors(["Add transcript text before analyzing so the assistant can read the full script context first."]);
        return;
      }
      const scoringContext: AiScoringContext = { ...aiContext, fullScriptContext };

      const indexed = await indexMediaLibraryForAi(mediaItems, (done, total) => {
        setAiBusyMessage(`Indexing library asset ${done}/${total}`);
      });
      setAiCacheHits(indexed.cacheHits);

      setAiBusyMessage("Profiling media semantics");
      const profilePool = indexed.candidates.slice(0, dynamicEditorSettings.candidatePoolSize);
      const profiled = dynamicEditorSettings.analysisDepth === "fast"
        ? {
            profiles: profilePool.map((candidate) => createFallbackAssetProfile(candidate)),
            providersUsed: [],
            errors: [],
          }
        : await profileAssetsWithAi(profilePool, aiMode, scoringContext, (done, total) => {
            setAiBusyMessage(`Profiling media asset ${done}/${total}`);
          });
      const profiles = profiled.profiles;

      setAiBusyMessage("Analyzing script beats and assigning media");
      const dynamicResult = buildDynamicEditorResult(segments, mediaItems, profiles, dynamicEditorSettings);
      setAiRankingsBySegmentId(dynamicResult.rankingsBySegmentId);
      setDynamicMetrics(dynamicResult.metrics);

      const fallbackWarnings = indexed.candidates
        .filter((candidate) => candidate.mediaType === "video" && !candidate.visualPaths?.length)
        .map((candidate) => `Limited video analysis for ${candidate.name}; extracted frames were unavailable.`);
      const cappedWarning = indexed.candidates.length > profilePool.length
        ? [`Profiled ${profilePool.length}/${indexed.candidates.length} assets based on candidate pool size.`]
        : [];
      setAiErrors(
        [
          ...indexed.warnings,
          ...fallbackWarnings,
          ...profiled.errors,
          ...cappedWarning,
        ],
      );
    } catch (error) {
      setAiErrors([String(error)]);
    } finally {
      setAiBusyMessage(null);
    }
  }

  async function chooseImageFolder() {
    try {
      const folderResult = await pickFolder(imageFolderPath);
      if (folderResult.status === "cancelled") {
        return;
      }

      if (folderResult.status !== "selected" || !folderResult.path) {
        setFolderError(folderResult.message ?? "Folder picker is unavailable in this Premiere runtime.");
        return;
      }

      setImageFolderPath(folderResult.path);
      setFolderError(null);
      setResult(null);
    } catch (error) {
      setFolderError(String(error));
    }
  }

  async function loadPremiereMarkers() {
    setTranscriptError(null);

    try {
      const segments = await getPremiereTranscriptSegments();
      if (segments.length === 0) {
        setTranscriptError("No sequence markers with comments/names were found in the active Premiere sequence.");
        return;
      }

      setScriptText(formatMarkerTranscript(segments));
      setScriptSourceName(`Premiere markers (${segments.length})`);
      setTranscriptSourceMode("premiere-markers");
      setResult(null);
    } catch (error) {
      setTranscriptError(String(error));
    }
  }

  function handleScriptUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setScriptText(String(reader.result ?? ""));
      setScriptSourceName(file.name);
      setTranscriptSourceMode("upload");
      setTranscriptError(null);
      setResult(null);
    };
    reader.readAsText(file);
  }

  function handleManualFolderLoad() {
    if (!imageFolderPath.trim()) {
      setFolderError("Enter or choose a media folder path first.");
      return;
    }

    applyScanResult(scanLibraryFolder(imageFolderPath, libraryMode, mediaSortMode));
  }

  async function handlePlaceOnTimeline() {
    if (!previewPlan) {
      return;
    }

    setBusyMessage("Sending plan to Premiere");
    setResult(null);

    const payload: ExecuteTimelineJobInput = {
      targetVideoTrackIndex: Math.max(0, targetVideoTrack - 1),
      appendAtTrackEnd,
      useSequenceInOut: false,
      rangeStartSec: null,
      rangeEndSec: null,
      placements: previewPlan.placements.map((placement) => ({
        id: placement.id,
        groupId: placement.groupId,
        layerIndex: placement.layerIndex,
        trackOffset: placement.trackOffset,
        startSec: placement.startSec,
        endSec: placement.endSec,
        durationSec: placement.durationSec,
        sourceInSec: placement.sourceInSec,
        sourceOutSec: placement.sourceOutSec,
        mediaPath: placement.mediaPath,
        strategy: placement.strategy,
        text: placement.text,
      })),
    };

    try {
      const nextResult = await executeTimelineJob(payload);
      setResult(nextResult);
      await refreshPremiereStatus();
    } catch (error) {
      setResult({
        ok: false,
        message: String(error),
        placedCount: 0,
        blankCount: 0,
        importedCount: 0,
        appendOffsetSec: 0,
        skippedCount: 0,
        clippedCount: 0,
        workingRangeStartSec: 0,
        workingRangeEndSec: 0,
      });
    } finally {
      setBusyMessage(null);
    }
  }

  async function handleCopyPrompt(promptId: string) {
    const prompt = missingAssetPlan.prompts.find((item) => item.id === promptId);
    if (!prompt) {
      return;
    }

    await copyText(formatMissingAssetPrompt(prompt));
    setCopiedPromptIds((previous) => ({ ...previous, [promptId]: true }));
  }

  async function handleCopyAllPrompts() {
    await copyText(formatMissingAssetPlanMarkdown(missingAssetPlan));
    setCopiedPromptIds((previous) => ({
      ...previous,
      ...Object.fromEntries(missingAssetPlan.prompts.map((prompt) => [prompt.id, true])),
    }));
  }

  async function handleRefinePromptPlan() {
    if (missingAssetPlan.prompts.length === 0) {
      return;
    }

    setPromptRefineBusyMessage("Refining prompts with AI");
    setPromptRefinementResult(null);
    try {
      const result = await refineMissingAssetPlanWithAi(
        missingAssetPlan,
        aiMode,
        aiContext,
        (done, total) => setPromptRefineBusyMessage(`Refining prompts ${done}/${total}`),
      );
      setRefinedMissingAssetPlan(result.plan);
      setPromptRefinementResult(result);
    } catch (error) {
      setPromptRefinementResult({
        plan: missingAssetPlan,
        providerUsed: null,
        refinedCount: 0,
        errors: [String(error)],
      });
    } finally {
      setPromptRefineBusyMessage(null);
    }
  }

  function handleResetPrompt(promptId: string) {
    setRefinedMissingAssetPlan((previous) => {
      if (!previous) {
        return previous;
      }

      return {
        ...previous,
        prompts: previous.prompts.map((prompt) =>
          prompt.id === promptId ? resetPromptRefinement(prompt) : prompt,
        ),
      };
    });
  }

  function handleResetAllPrompts() {
    setRefinedMissingAssetPlan(null);
    setPromptRefinementResult(null);
  }

  function handleAttachDraftChange(promptId: string, patch: Partial<AssetAttachDraft>) {
    setAssetDraftsByPromptId((previous) => ({
      ...previous,
      [promptId]: {
        filePath: "",
        sourceTool: "Manual",
        notes: "",
        ...(previous[promptId] ?? {}),
        ...patch,
      },
    }));
  }

  function handleAttachGeneratedAsset(promptId: string) {
    const prompt = missingAssetPlan.prompts.find((item) => item.id === promptId);
    const draft = assetDraftsByPromptId[promptId];
    if (!prompt || !draft?.filePath.trim()) {
      return;
    }

    const durationMetadata = probeGeneratedAssetDurationMetadata(draft.filePath);
    const asset = createImportedGeneratedAsset(prompt, draft, durationMetadata);
    setGeneratedAssets((previous) => [asset, ...previous]);
    setAssetDraftsByPromptId((previous) => ({
      ...previous,
      [promptId]: { filePath: "", sourceTool: "Manual", notes: "" },
    }));
    setActiveAttachPromptId(null);
  }

  function handleUpdateGeneratedAssetStatus(
    assetId: string,
    status: ImportedGeneratedAsset["status"],
  ) {
    setGeneratedAssets((previous) =>
      previous.map((asset) => (asset.id === assetId ? { ...asset, status } : asset)),
    );
    if (status !== "approved") {
      setAppliedGeneratedAssetIdsByPlacementId((previous) =>
        Object.fromEntries(Object.entries(previous).filter(([, appliedAssetId]) => appliedAssetId !== assetId)),
      );
      setGeneratedAssetApplySummary(null);
    }
  }

  function handleUnlinkGeneratedAsset(assetId: string) {
    setGeneratedAssets((previous) => previous.filter((asset) => asset.id !== assetId));
    setAppliedGeneratedAssetIdsByPlacementId((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([, appliedAssetId]) => appliedAssetId !== assetId)),
    );
    setGeneratedAssetApplySummary(null);
  }

  async function handleCopyGeneratedAssetPath(asset: ImportedGeneratedAsset) {
    await copyText(asset.filePath);
  }

  function handleProbeGeneratedAssetDuration(assetId: string) {
    setGeneratedAssets((previous) =>
      previous.map((asset) =>
        asset.id === assetId
          ? {
              ...asset,
              ...probeGeneratedAssetDurationMetadata(asset.filePath),
            }
          : asset,
      ),
    );
    setGeneratedAssetApplySummary(null);
  }

  function handleExportAssetInbox(format: "json" | "csv") {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `weave-edit-asset-inbox-${timestamp}.${format}`;
    const content =
      format === "json"
        ? JSON.stringify(generatedAssets, null, 2)
        : formatAssetInboxCsv(generatedAssets);
    downloadTextFile(fileName, content, format === "json" ? "application/json" : "text/csv");
  }

  function handleUseGeneratedAssetInPlan(asset: ImportedGeneratedAsset) {
    if (!effectivePlan) {
      return;
    }

    const nextMap = {
      ...appliedGeneratedAssetIdsByPlacementId,
      [asset.linkedPlacementId]: asset.id,
    };
    const result = applyGeneratedAssetsToPlacements({
      placements: effectivePlan.placements,
      assets: generatedAssets,
      appliedAssetIdsByPlacementId: nextMap,
      fileExists: generatedAssetPathExists,
      promptRecommendedPlacementIds,
    });
    const applied = result.placements.some(
      (placement) => placement.id === asset.linkedPlacementId && placement.generatedAssetId === asset.id,
    );
    setAppliedGeneratedAssetIdsByPlacementId(
      applied
        ? nextMap
        : Object.fromEntries(
            Object.entries(appliedGeneratedAssetIdsByPlacementId).filter(([, appliedAssetId]) => appliedAssetId !== asset.id),
          ),
    );
    setGeneratedAssetApplySummary(result.summary);
  }

  function handleUseAllApprovedAssetsInPlan() {
    if (!effectivePlan) {
      return;
    }

    const result = buildApprovedGeneratedAssetMap(
      effectivePlan.placements,
      generatedAssets,
      generatedAssetPathExists,
      promptRecommendedPlacementIds,
    );
    setAppliedGeneratedAssetIdsByPlacementId(result.appliedAssetIdsByPlacementId);
    setGeneratedAssetApplySummary(result.summary);
  }

  function handleRestoreGeneratedAssetPlacement(placementId: string) {
    setAppliedGeneratedAssetIdsByPlacementId((previous) => {
      const { [placementId]: _removed, ...next } = previous;
      return next;
    });
    setGeneratedAssetApplySummary(null);
  }

  function handleRestoreAllGeneratedAssetPlacements() {
    setAppliedGeneratedAssetIdsByPlacementId({});
    setGeneratedAssetApplySummary(null);
  }

  function handleExportPromptBrief(format: "md" | "txt" | "json") {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `weave-edit-missing-asset-plan-${timestamp}.${format}`;
    const content =
      format === "json"
        ? JSON.stringify(missingAssetPlan, null, 2)
        : formatMissingAssetPlanMarkdown(missingAssetPlan);
    downloadTextFile(fileName, content, format === "json" ? "application/json" : "text/plain");
  }

  async function handlePreviewSilenceCleanup() {
    setSilenceBusyMessage("Detecting silence");
    setSilencePreview(null);

    try {
      const preview = await previewSilenceCleanup({
        targetAudioTrackIndex: Math.max(0, targetAudioTrack - 1),
        silenceThresholdDb,
        minSilenceSec: clampDurationInput(minSilenceSec, 0.05),
        keepSilenceSec: clampDurationInput(keepSilenceSec, 0),
      });
      setSilencePreview(preview);
    } catch (error) {
      setSilencePreview({
        ok: false,
        message: String(error),
        spans: [],
        details: [],
      });
    } finally {
      setSilenceBusyMessage(null);
    }
  }

  async function handleApplySilenceCleanup() {
    if (!silencePreview?.spans.length) {
      return;
    }

    setSilenceBusyMessage("Marking silence");
    try {
      const cleanup = await executeSilenceCleanup({
        targetAudioTrackIndex: Math.max(0, targetAudioTrack - 1),
        silenceThresholdDb,
        minSilenceSec: clampDurationInput(minSilenceSec, 0.05),
        keepSilenceSec: clampDurationInput(keepSilenceSec, 0),
        spans: silencePreview.spans,
      });
      setSilencePreview({
        ok: cleanup.ok,
        message: cleanup.message,
        spans: silencePreview.spans,
        details: cleanup.details,
      });
    } catch (error) {
      setSilencePreview({
        ok: false,
        message: String(error),
        spans: silencePreview.spans,
        details: [],
      });
    } finally {
      setSilenceBusyMessage(null);
    }
  }

  return (
    <main className="dark min-h-screen bg-background px-4 py-6 text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="rounded-[28px] border border-border/70 bg-card/95 p-6 shadow-2xl shadow-black/20">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-4xl">
              <StatusPill
                tone={isCepEnvironment() ? "success" : "warning"}
                label={isCepEnvironment() ? "Premiere panel runtime" : "Browser preview only"}
              />
              <h1 className="mt-4 text-3xl font-semibold tracking-tight">Weave Edit</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                Premiere panel for transcript-led B-roll placement. Load markers, scan a local
                image/video library, let Gemma shape the edit, then review before placing.
              </p>
              <button
                type="button"
                onClick={() => setShowAdvancedUi((value) => !value)}
                className="mt-4 rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
              >
                {showAdvancedUi ? "Hide advanced UI" : "Show advanced UI"}
              </button>
            </div>
            <div className="grid min-w-[300px] gap-3 rounded-3xl border border-border/70 bg-background/70 p-4">
              <SummaryRow label="Project" value={hostStatus?.projectName || "Not connected"} />
              <SummaryRow label="Sequence" value={hostStatus?.sequenceName || "Open a sequence"} />
              <SummaryRow
                label="Working range"
                value={
                  appendAtTrackEnd
                    ? "Append after target track end"
                    : hasMeaningfulInOut
                      ? `${formatSeconds(hostStatus?.range.inSec ?? 0)} - ${formatSeconds(hostStatus?.range.outSec ?? 0)}`
                      : useWholeSequenceFallback
                        ? "Whole-sequence fallback"
                        : "In/Out not set"
                }
              />
              <SummaryRow
                label="Target"
                value={`V${targetVideoTrack}${hostStatus?.videoTracks[targetVideoTrack - 1] ? ` / ${hostStatus.videoTracks[targetVideoTrack - 1].name}` : ""}`}
              />
              <SummaryRow
                label="AI"
                value={
                  aiMode === "off"
                    ? "Off"
                    : aiMode === "local"
                      ? `${ollamaModel} via Ollama`
                      : `${ollamaModel} primary / Gemini fallback`
                }
              />
              <SummaryRow
                label="Video tools"
                value={`ffprobe ${videoTooling.ffprobeAvailable ? "ready" : "missing"} / ffmpeg ${videoTooling.ffmpegAvailable ? "ready" : "missing"}`}
              />
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-6">
            <PanelSection
              step="1"
              title="Script / Transcript"
              description="Use Premiere markers when available, or upload a timestamped script. Sentence boundaries drive timing, and incomplete thoughts stay shorter unless AI has a stronger editorial reason."
              action={
                <div className="flex flex-wrap gap-2">
                  {isCepEnvironment() ? (
                    <button
                      type="button"
                      onClick={() => void loadPremiereMarkers()}
                      className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
                    >
                      Load Premiere markers
                    </button>
                  ) : null}
                  <label className="cursor-pointer rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent">
                    Load script file
                    <input
                      type="file"
                      accept=".srt,.txt,.csv"
                      className="hidden"
                      onChange={handleScriptUpload}
                    />
                  </label>
                </div>
              }
            >
              <div className="grid gap-4 md:grid-cols-[0.8fr_1.2fr]">
                {showAdvancedUi ? (
                  <>
                    <label className="grid gap-2 text-sm">
                      <span className="text-muted-foreground">Transcript source</span>
                      <select
                        value={transcriptSourceMode}
                        onChange={(event) =>
                          setTranscriptSourceMode(event.target.value as "upload" | "premiere-markers")
                        }
                        className="rounded-3xl border border-border/70 bg-background/60 px-4 py-3 text-sm outline-none transition focus:border-primary"
                      >
                        <option value="premiere-markers">Premiere markers first</option>
                        <option value="upload">Uploaded script only</option>
                      </select>
                    </label>
                    <div className="rounded-3xl border border-border/70 bg-background/60 px-4 py-3 text-sm text-muted-foreground">
                      {transcriptSourceMode === "premiere-markers"
                        ? "Preferred source: active sequence markers/comments in Premiere. Upload stays available as fallback."
                        : "Preferred source: uploaded timestamped script. Premiere markers are optional reference only."}
                    </div>
                  </>
                ) : (
                  <div className="md:col-span-2 rounded-3xl border border-border/70 bg-background/60 px-4 py-3 text-sm text-muted-foreground">
                    Default transcript workflow uses Premiere markers when available; open Advanced to pin uploads-only mode.
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-border/70 bg-background/60 px-4 py-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Source: {scriptSourceName}
              </div>
              <textarea
                value={scriptText}
                onChange={(event) => {
                  setScriptText(event.target.value);
                  setScriptSourceName("Pasted text");
                }}
                placeholder={`1\n00:00:00,000 --> 00:00:05,000\nOpening statement about the city skyline\n\n2\n00:00:05,000 --> 00:00:10,000\nClose-up on busy streets and people walking`}
                className="min-h-[270px] w-full rounded-3xl border border-border/70 bg-background/60 px-4 py-4 font-mono text-sm leading-6 outline-none transition focus:border-primary"
              />
              {parsedScriptState.error ? (
                <InlineMessage tone="error" message={parsedScriptState.error} />
              ) : transcriptError ? (
                <InlineMessage tone="warning" message={transcriptError} />
              ) : parsedScriptState.result ? (
                <InlineMessage
                  tone="neutral"
                  message={`Parsed ${parsedScriptState.result.segments.length} transcript segments from ${parsedScriptState.result.format}. Sentence boundaries now steer duration.`}
                />
              ) : (
                <InlineMessage
                  tone="neutral"
                  message="Use SRT, HH:MM:SS.mmm, or frame timecode such as 00:00:45:02."
                />
              )}
            </PanelSection>

            <PanelSection
              step="2"
              title="Media Library"
              description="Choose whether this pass should scan images, videos, or both. Folder selection should return the picked path directly into the source field, and scan warnings should stay explicit."
              action={
                <div className="flex flex-wrap gap-2">
                  {isCepEnvironment() ? (
                    <button
                      type="button"
                      onClick={() => void chooseImageFolder()}
                      disabled={!canChooseFolder}
                      className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
                    >
                      Choose folder
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleManualFolderLoad}
                    className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
                  >
                    Scan folder
                  </button>
                </div>
              }
            >
              <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
                <label className="grid gap-2 text-sm">
                  <span className="text-muted-foreground">Library type</span>
                  <select
                    value={libraryMode}
                    onChange={(event) => setLibraryMode(event.target.value as MediaLibraryMode)}
                    className="rounded-3xl border border-border/70 bg-background/60 px-4 py-3 text-sm outline-none transition focus:border-primary"
                  >
                    <option value="images">Images only</option>
                    <option value="videos">Videos only</option>
                    <option value="mixed">Mixed images and videos</option>
                  </select>
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="text-muted-foreground">Folder order</span>
                  <select
                    value={mediaSortMode}
                    onChange={(event) => setMediaSortMode(event.target.value as MediaSortMode)}
                    className="rounded-3xl border border-border/70 bg-background/60 px-4 py-3 text-sm outline-none transition focus:border-primary"
                  >
                    <option value="downloaded-oldest">Downloaded/created old to new</option>
                    <option value="created-oldest">Created old to new</option>
                    <option value="modified-oldest">Modified old to new</option>
                    <option value="name">Name A-Z</option>
                  </select>
                </label>
              </div>
              <div className="rounded-3xl border border-border/70 bg-background/60 px-4 py-3 text-sm text-muted-foreground">
                {imageFolderPath
                  ? `Current source folder: ${imageFolderPath}`
                  : "Choose a folder and Weave Edit will write it here, then scan the source library."}
              </div>
              <input
                value={imageFolderPath}
                onChange={(event) => setImageFolderPath(event.target.value)}
                placeholder="C:/path/to/media-folder"
                className="w-full rounded-3xl border border-border/70 bg-background/60 px-4 py-3 text-sm outline-none transition focus:border-primary"
              />
              <div className="grid gap-4 md:grid-cols-3">
                <StatCard label="Media found" value={mediaItems.length.toString()} />
                <StatCard label="Images / videos" value={`${libraryStats.images} / ${libraryStats.videos}`} />
                <StatCard label="Blank fallback" value={previewStats.blank.toString()} />
              </div>
              {folderError ? <InlineMessage tone="error" message={folderError} /> : null}
              {!canChooseFolder && isCepEnvironment() ? (
                <InlineMessage
                  tone="warning"
                  message="Native folder picker bridge is unavailable. Reinstall the extension and restart Premiere, or paste the folder path manually and use Scan folder."
                />
              ) : null}
              {scanWarnings.length > 0 ? (
                <InlineMessage
                  tone="warning"
                  message={`Scan warnings: ${scanWarnings.slice(0, 2).join(" | ")}`}
                />
              ) : null}
              {showAdvancedUi && mediaItems.length > 0 ? (
                <div className="rounded-3xl border border-border/70 bg-background/60 p-4">
                  <p className="text-sm font-medium">First files</p>
                  <div className="mt-3 max-h-40 space-y-1 overflow-auto font-mono text-xs text-muted-foreground">
                    {mediaItems.slice(0, 12).map((item) => (
                      <p key={item.path}>
                        [{item.type}] {item.createdMs ? new Date(item.createdMs).toLocaleString() : "no time"} · {item.path}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
            </PanelSection>

            <PanelSection
              step="3"
              title="Edit Planning"
              description="Placement mode chooses how media lines up with each script span. Preferred shot length merges beats toward longer reads; variation adds bounded randomness inside transcript timing."
            >
              <div className="grid gap-5">
                <label className="grid gap-2 text-sm">
                  <span className="text-muted-foreground">Placement mode</span>
                  <select
                    value={placementStrategyMode}
                    onChange={(event) => setPlacementStrategyMode(event.target.value as PlacementStrategyMode)}
                    className="rounded-3xl border border-border/70 bg-background/60 px-4 py-3 text-sm outline-none transition focus:border-primary"
                  >
                    <option value="folder-order">Folder order old-to-new (personal mode)</option>
                    <option value="ai-dynamic">AI dynamic matching</option>
                    <option value="hybrid-fallback">AI first, folder order fallback</option>
                  </select>
                  <span className="text-xs text-muted-foreground">
                    Folder-order ignores scoring and walks files in scanned old-to-new order.
                  </span>
                </label>

                <label className="grid gap-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-muted-foreground">Preferred shot length</span>
                    <span className="font-mono text-xs text-muted-foreground">{averageShotLengthSec}s</span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={14}
                    step={0.5}
                    value={averageShotLengthSec}
                    onChange={(event) =>
                      setAverageShotLengthSec(clampDurationInput(Number(event.target.value), 1))
                    }
                    className="w-full accent-primary"
                  />
                  <span className="text-xs text-muted-foreground">
                    Targets longer beats before phrase splits; transcript timing always wins for hard boundaries.
                  </span>
                </label>

                <label className="grid gap-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-muted-foreground">Variation strength</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {(variationStrength * 100).toFixed(0)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(variationStrength * 100)}
                    onChange={(event) =>
                      setVariationStrength(clampVariationStrength(Number(event.target.value) / 100))
                    }
                    className="w-full accent-primary"
                  />
                  <span className="text-xs text-muted-foreground">
                    Seeded drift reshuffles durations inside each script window—never shorter than the readable floor.
                  </span>
                </label>

                <div className="rounded-3xl border border-border/70 bg-background/60 px-4 py-3 text-sm text-muted-foreground">
                  Duration summary — safety rails{" "}
                  <span className="font-mono text-foreground">
                    {minDurationSec}s–{maxDurationSec}s
                  </span>
                  , pacing{" "}
                  <span className="text-foreground">
                    {pacingPreset === "social-fast"
                      ? "Social fast"
                      : pacingPreset === "cinematic-slow"
                        ? "Cinematic slow"
                        : pacingPreset === "tutorial"
                          ? "Tutorial"
                          : "Documentary"}
                  </span>
                  . Open Advanced to edit rails, pacing preset, or AI reviewers.
                </div>

                <div className="grid gap-3">
                  <ToggleRow
                    checked={appendAtTrackEnd}
                    onChange={setAppendAtTrackEnd}
                    label="Append after the current end of the target track"
                    description="Continue later without relying on sequence In/Out."
                  />
                  <ToggleRow
                    checked={useWholeSequenceFallback}
                    onChange={setUseWholeSequenceFallback}
                    disabled={appendAtTrackEnd}
                    label="Allow whole-sequence fallback when no In/Out marks are set"
                    description="Turn off to require editorial marks before placing."
                  />
                </div>
              </div>

              <div className="rounded-3xl border border-border/70 bg-background/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Director Controls</p>
                    <h3 className="mt-2 text-base font-semibold">Edit Recipe</h3>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                      Steer the AI like an editor: goal, style, caption feel, and the offer context.
                    </p>
                  </div>
                  <StatusPill tone="info" label={getOptionLabel(EDIT_STYLE_OPTIONS, editStyle)} />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <DirectionSelect
                    label="Edit goal"
                    value={editGoal}
                    options={EDIT_GOAL_OPTIONS}
                    onChange={(value) => setEditGoal(value as EditGoal)}
                  />
                  <DirectionSelect
                    label="Edit style"
                    value={editStyle}
                    options={EDIT_STYLE_OPTIONS}
                    onChange={(value) => setEditStyle(value as EditStyle)}
                  />
                  <DirectionSelect
                    label="B-roll style"
                    value={brollStyle}
                    options={BROLL_STYLE_OPTIONS}
                    onChange={(value) => setBrollStyle(value as BrollStyle)}
                  />
                  <DirectionSelect
                    label="Caption style"
                    value={captionStyle}
                    options={CAPTION_STYLE_OPTIONS}
                    onChange={(value) => setCaptionStyle(value as CaptionStyle)}
                  />
                </div>
                <label className="mt-4 block text-sm">
                  <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    CTA / offer context
                  </span>
                  <input
                    value={ctaContext}
                    onChange={(event) => setCtaContext(event.target.value)}
                    placeholder="Comment MONEY and I will DM you the quiz + webinar link."
                    className="mt-2 w-full rounded-2xl border border-border/70 bg-card px-3 py-2 outline-none transition focus:border-primary"
                  />
                </label>
                <label className="mt-4 block text-sm">
                  <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Custom creative direction
                  </span>
                  <textarea
                    value={creativeDirection}
                    onChange={(event) => setCreativeDirection(event.target.value)}
                    placeholder="Make this feel like a premium money mentor reel. Avoid cheesy stock visuals."
                    className="mt-2 min-h-[82px] w-full rounded-2xl border border-border/70 bg-card px-3 py-3 outline-none transition focus:border-primary"
                  />
                </label>
                <label className="mt-4 block text-sm">
                  <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Brand notes
                  </span>
                  <textarea
                    value={brandNotes}
                    onChange={(event) => setBrandNotes(event.target.value)}
                    placeholder="Dark premium look, yellow highlight words, no emojis, confident tone."
                    className="mt-2 min-h-[70px] w-full rounded-2xl border border-border/70 bg-card px-3 py-3 outline-none transition focus:border-primary"
                  />
                </label>
              </div>

              {showAdvancedUi ? (
                <>
                  <div className="mt-6 grid gap-4 md:grid-cols-3">
                    <NumberField
                      label="Min safety duration"
                      value={minDurationSec}
                      min={0.5}
                      step={0.5}
                      onChange={setMinDurationSec}
                    />
                    <NumberField
                      label="Max safety duration"
                      value={maxDurationSec}
                      min={0.5}
                      step={0.5}
                      onChange={setMaxDurationSec}
                    />
                    <TrackField
                      tracks={hostStatus?.videoTracks ?? []}
                      value={targetVideoTrack}
                      onChange={setTargetVideoTrack}
                    />
                  </div>

                  <div className="mt-6 rounded-3xl border border-border/70 bg-background/60 p-4">
                    <p className="text-sm font-medium">Advanced AI and editorial matching</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Local models profile media after the folder is indexed; whole-script context is sent on every analyze run.
                    </p>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">AI story matching</p>
                      <select
                        value={aiMode}
                        onChange={(event) => setAiMode(event.target.value as AiMode)}
                        className="rounded-2xl border border-border/70 bg-card px-3 py-2 text-sm"
                      >
                        <option value="off">Off</option>
                        <option value="local">Local (Ollama)</option>
                        <option value="hybrid">Hybrid (Ollama + Gemini fallback)</option>
                      </select>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <label className="text-sm">
                        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          Ollama endpoint
                        </span>
                        <input
                          value={ollamaBaseUrl}
                          onChange={(event) => setOllamaBaseUrl(event.target.value)}
                          className="mt-2 w-full rounded-2xl border border-border/70 bg-card px-3 py-2"
                        />
                      </label>
                      <label className="text-sm">
                        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          Ollama model
                        </span>
                        <input
                          value={ollamaModel}
                          onChange={(event) => setOllamaModel(event.target.value)}
                          className="mt-2 w-full rounded-2xl border border-border/70 bg-card px-3 py-2"
                        />
                      </label>
                      <label className="text-sm">
                        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          Gemini fallback model
                        </span>
                        <input
                          value={geminiModel}
                          onChange={(event) => setGeminiModel(event.target.value)}
                          className="mt-2 w-full rounded-2xl border border-border/70 bg-card px-3 py-2"
                        />
                      </label>
                      <label className="text-sm">
                        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          AI confidence threshold
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={aiConfidenceThreshold}
                          onChange={(event) =>
                            setAiConfidenceThreshold(Math.max(0, Math.min(1, Number(event.target.value))))
                          }
                          className="mt-2 w-full rounded-2xl border border-border/70 bg-card px-3 py-2"
                        />
                      </label>
                      <label className="text-sm">
                        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          Pacing preset
                        </span>
                        <select
                          value={pacingPreset}
                          onChange={(event) => setPacingPreset(event.target.value as EditorPacingPreset)}
                          className="mt-2 w-full rounded-2xl border border-border/70 bg-card px-3 py-2"
                        >
                          <option value="documentary">Documentary</option>
                          <option value="social-fast">Social fast cut</option>
                          <option value="cinematic-slow">Cinematic slow</option>
                          <option value="tutorial">Tutorial / explainer</option>
                        </select>
                      </label>
                      <label className="text-sm">
                        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          Cut boundary
                        </span>
                        <select
                          value={cutBoundaryMode}
                          onChange={(event) => setCutBoundaryMode(event.target.value as CutBoundaryMode)}
                          className="mt-2 w-full rounded-2xl border border-border/70 bg-card px-3 py-2"
                        >
                          <option value="ai">AI decides</option>
                          <option value="phrase">Phrase</option>
                          <option value="sentence">Sentence</option>
                          <option value="beat">Paragraph / beat</option>
                        </select>
                      </label>
                      <label className="text-sm">
                        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          Match style
                        </span>
                        <select
                          value={matchStyle}
                          onChange={(event) => setMatchStyle(event.target.value as MatchStyle)}
                          className="mt-2 w-full rounded-2xl border border-border/70 bg-card px-3 py-2"
                        >
                          <option value="balanced">Balanced</option>
                          <option value="literal">Literal</option>
                          <option value="emotional">Emotional</option>
                          <option value="metaphorical">Metaphorical</option>
                        </select>
                      </label>
                      <label className="text-sm">
                        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          Asset reuse
                        </span>
                        <select
                          value={assetReusePolicy}
                          onChange={(event) => setAssetReusePolicy(event.target.value as AssetReusePolicy)}
                          className="mt-2 w-full rounded-2xl border border-border/70 bg-card px-3 py-2"
                        >
                          <option value="avoid-repeat">Avoid repeat</option>
                          <option value="allow-small-folder-repeat">Allow repeat for small folders</option>
                          <option value="story-continuity">Story continuity reuse</option>
                        </select>
                      </label>
                  <label className="text-sm">
                    <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Video trim policy
                    </span>
                    <select
                      value={videoTrimPolicy}
                      onChange={(event) => setVideoTrimPolicy(event.target.value as VideoTrimPolicy)}
                      className="mt-2 w-full rounded-2xl border border-border/70 bg-card px-3 py-2"
                    >
                      <option value="trim-to-beat">Trim to beat</option>
                      <option value="full-clip">Use full clip when possible</option>
                      <option value="best-subspan">Best source subspan</option>
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Analysis depth
                    </span>
                    <select
                      value={analysisDepth}
                      onChange={(event) => setAnalysisDepth(event.target.value as AnalysisDepth)}
                      className="mt-2 w-full rounded-2xl border border-border/70 bg-card px-3 py-2"
                    >
                      <option value="fast">Fast metadata</option>
                      <option value="visual-frames">Visual frames</option>
                      <option value="full-ai">Full AI review</option>
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Candidate pool size
                    </span>
                    <input
                      type="number"
                      min={10}
                      max={500}
                      step={10}
                      value={candidatePoolSize}
                      onChange={(event) => setCandidatePoolSize(Math.max(10, Number(event.target.value)))}
                      className="mt-2 w-full rounded-2xl border border-border/70 bg-card px-3 py-2"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Rerank depth
                    </span>
                    <input
                      type="number"
                      min={3}
                      max={50}
                      step={1}
                      value={rerankDepth}
                      onChange={(event) => setRerankDepth(Math.max(3, Number(event.target.value)))}
                      className="mt-2 w-full rounded-2xl border border-border/70 bg-card px-3 py-2"
                    />
                  </label>
                </div>
                <label className="mt-4 block text-sm">
                  <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Custom instructions
                  </span>
                  <textarea
                    value={customInstructions}
                    onChange={(event) => setCustomInstructions(event.target.value)}
                    placeholder="Example: Prefer symbolic visuals, avoid repeated assets, allow 2-layer overlap only on emotional peaks, keep pacing restrained."
                    className="mt-2 min-h-[110px] w-full rounded-2xl border border-border/70 bg-card px-3 py-3 outline-none transition focus:border-primary"
                  />
                </label>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void runAiHealthCheck()}
                    className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
                  >
                    {aiBusyMessage === "Checking AI providers" ? "Checking..." : "Check providers"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAiRanking()}
                    disabled={
                      aiMode === "off" ||
                      placementStrategyMode === "folder-order" ||
                      !parsedScriptState.result ||
                      mediaItems.length === 0
                    }
                    className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
                  >
                    {placementStrategyMode === "folder-order"
                      ? "AI not needed for folder order"
                      : aiBusyMessage
                        ? aiBusyMessage
                        : "Analyze with AI"}
                  </button>
                </div>
                <div className="mt-4 space-y-2">
                  <div className="grid gap-3 md:grid-cols-2">
                    <StatusCard
                      label="Primary AI"
                      value={aiMode === "off" ? "Disabled" : `Local Ollama / ${ollamaModel}`}
                    />
                    <StatusCard
                      label="Fallback"
                      value={
                        aiMode === "hybrid"
                          ? geminiApiKey
                            ? `Gemini ${geminiModel} only after local failure`
                            : "Gemini fallback unavailable: missing environment key"
                          : "Disabled unless Hybrid mode is selected"
                      }
                    />
                    <StatusCard
                      label="Frame analysis"
                      value={
                        analysisDepth === "fast"
                          ? "Fast metadata mode; no frame review"
                          : videoTooling.ffmpegAvailable
                            ? "Enabled for videos with extracted representative frames"
                            : "Limited: ffmpeg missing, videos use filename/duration hints"
                      }
                    />
                    <StatusCard
                      label="Duration engine"
                      value={`Pacing ${pacingPreset}, variation ${(variationStrength * 100).toFixed(0)}%, target ${averageShotLengthSec}s`}
                    />
                  </div>
                  {aiHealth.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Provider status will appear after running checks.
                    </p>
                  ) : (
                    aiHealth.map((status) => (
                      <div
                        key={status.provider}
                        className="flex items-center justify-between rounded-2xl border border-border/70 px-3 py-2 text-sm"
                      >
                        <span>{status.provider}</span>
                        <span className={status.ok ? "text-emerald-300" : "text-amber-300"}>
                          {status.message}
                        </span>
                      </div>
                    ))
                  )}
                  {aiMode === "hybrid" ? (
                    <p className="text-xs text-muted-foreground">
                      Gemini key status: {geminiApiKey ? "configured in environment" : "not set"}.
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Local video tools: ffprobe {videoTooling.ffprobeAvailable ? "ready" : "missing"} /
                    ffmpeg {videoTooling.ffmpegAvailable ? "ready" : "missing"}.
                  </p>
                </div>
                  </div>
                </>
              ) : null}
              {showAdvancedUi ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <StatusCard
                    label="Range status"
                    value={
                      appendAtTrackEnd
                        ? "Append mode active"
                        : hasMeaningfulInOut
                          ? `In ${formatSeconds(hostStatus?.range.inSec ?? 0)} / Out ${formatSeconds(hostStatus?.range.outSec ?? 0)}`
                          : "No meaningful In/Out marks detected"
                    }
                  />
                  <StatusCard
                    label="Execution mode"
                    value={
                      previewPlan?.mode === "sequence_in_out"
                        ? "Sequence In/Out priority"
                        : previewPlan?.mode === "append"
                          ? "Append after track end"
                          : previewPlan?.mode === "whole_sequence"
                            ? "Whole-sequence fallback"
                            : "Blocked until range is chosen"
                    }
                  />
                  <StatusCard
                    label="Timing engine"
                    value="Dynamic editor builds script beats first, then preserves beat boundaries before no-gap repair."
                  />
                  <StatusCard
                    label="Media review"
                    value={
                      placementStrategyMode === "folder-order"
                        ? "Personal mode is active: scanned files are placed old-to-new without AI reordering."
                        : placementStrategyMode === "hybrid-fallback"
                          ? "AI gets first choice, then old-to-new folder order fills weak matches."
                          : "The full folder is indexed before assignment; semantic profiles drive literal and emotional matching."
                    }
                  />
                </div>
              ) : null}
              {!appendAtTrackEnd && !hasMeaningfulInOut && !useWholeSequenceFallback ? (
                <InlineMessage
                  tone="warning"
                  message="Set sequence In/Out in Premiere, or enable whole-sequence fallback if you want placement without marks."
                />
              ) : null}
            </PanelSection>
          </div>

          <div className="space-y-6">
            {showAdvancedUi ? (
              <PanelSection
                step="4"
                title="Premiere status"
                description="Host details for troubleshooting sequence connectivity and track endpoints."
                action={
                  <button
                    type="button"
                    onClick={() => void refreshPremiereStatus()}
                    className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
                  >
                    Refresh
                  </button>
                }
              >
                <div className="rounded-3xl border border-border/70 bg-background/60 p-4 text-sm">
                  <div className="grid gap-3">
                    <SummaryRow label="Project" value={hostStatus?.projectName || "Not connected"} />
                    <SummaryRow label="Sequence" value={hostStatus?.sequenceName || "Open a sequence"} />
                    <SummaryRow
                      label="In point"
                      value={formatSeconds(hostStatus?.range.inSec ?? 0)}
                    />
                    <SummaryRow
                      label="Out point"
                      value={formatSeconds(hostStatus?.range.outSec ?? 0)}
                    />
                  </div>
                </div>
              </PanelSection>
            ) : null}

            <PanelSection
              step="5"
              title="Clean silence"
              description="Detect silent spans on the active Premiere audio track with local ffmpeg, then mark those ranges for safe timeline cleanup."
              action={
                <button
                  type="button"
                  onClick={() => void handlePreviewSilenceCleanup()}
                  disabled={Boolean(silenceBusyMessage)}
                  className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
                >
                  {silenceBusyMessage ?? "Preview silence"}
                </button>
              }
            >
              <div className="grid gap-4 md:grid-cols-2">
                <NumberField
                  label="Audio track"
                  value={targetAudioTrack}
                  min={1}
                  step={1}
                  onChange={(value) => setTargetAudioTrack(Math.max(1, Math.round(value)))}
                />
                <NumberField
                  label="Threshold dB"
                  value={silenceThresholdDb}
                  min={-90}
                  step={1}
                  onChange={setSilenceThresholdDb}
                />
                <NumberField
                  label="Minimum silence"
                  value={minSilenceSec}
                  min={0.05}
                  step={0.05}
                  onChange={setMinSilenceSec}
                />
                <NumberField
                  label="Keep silence"
                  value={keepSilenceSec}
                  min={0}
                  step={0.01}
                  onChange={setKeepSilenceSec}
                />
              </div>
              <InlineMessage
                tone="neutral"
                message="Apply currently creates reviewed silence markers in Premiere. This keeps your edit safe while still showing exactly what to ripple delete."
              />
              {silencePreview ? (
                <div className="rounded-3xl border border-border/70 bg-background/60 p-4 text-sm">
                  <p className={silencePreview.ok ? "text-emerald-400" : "text-destructive"}>
                    {silencePreview.message}
                  </p>
                  {silencePreview.spans.length > 0 ? (
                    <div className="mt-3 max-h-40 space-y-1 overflow-auto font-mono text-xs text-muted-foreground">
                      {silencePreview.spans.slice(0, 12).map((span) => (
                        <p key={span.id}>
                          A{span.trackIndex + 1} {formatSeconds(span.startSec)} - {formatSeconds(span.endSec)} · {span.clipName}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {silencePreview.details.length > 0 ? (
                    <div className="mt-3 space-y-1 text-xs text-amber-300">
                      {silencePreview.details.slice(0, 4).map((detail) => (
                        <p key={detail}>{detail}</p>
                      ))}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleApplySilenceCleanup()}
                    disabled={!silencePreview.spans.length || Boolean(silenceBusyMessage)}
                    className="mt-4 w-full rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Mark silence ranges in Premiere
                  </button>
                </div>
              ) : null}
            </PanelSection>

            <PanelSection
              step="6"
              title="Preview and execute"
              description="Review only the placements that matter for the current working range, then send them to Premiere."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <StatCard label="Preview placements" value={(previewPlan?.placements.length ?? 0).toString()} />
                <StatCard label="Skipped by range" value={(previewPlan?.skippedCount ?? 0).toString()} />
                <StatCard label="Clipped by range" value={(previewPlan?.clippedCount ?? 0).toString()} />
                <StatCard label="Covered duration" value={formatSeconds(previewPlan?.coverage.coveredSec ?? 0)} />
                <StatCard label="Remaining gap" value={`${(previewPlan?.coverage.gapSec ?? 0).toFixed(2)}s`} />
                <StatCard
                  label="Edit recipe"
                  value={`${getOptionLabel(EDIT_GOAL_OPTIONS, editGoal)} / ${getOptionLabel(EDIT_STYLE_OPTIONS, editStyle)}`}
                />
                {showAdvancedUi ? (
                  <>
                    <StatCard label="AI-assisted" value={(previewStats.ai ?? 0).toString()} />
                    <StatCard label="Generated in plan" value={(previewStats.generated ?? 0).toString()} />
                    <StatCard label="Low-confidence fallback" value={previewStats.fallback.toString()} />
                    <StatCard label="Manual overrides" value={previewStats.manual.toString()} />
                    <StatCard label="Overlap layers" value={previewStats.overlap.toString()} />
                    <StatCard label="Filled gaps" value={(previewPlan?.coverage.filledGapCount ?? 0).toString()} />
                    <StatCard label="Removed slivers" value={(previewPlan?.coverage.discardedSliverCount ?? 0).toString()} />
                    <StatCard label="Reused media" value={(previewPlan?.coverage.reusedAssetPlacements ?? 0).toString()} />
                    <StatCard label="Cached reviews" value={aiCacheHits.toString()} />
                    <StatCard label="Indexed assets" value={dynamicMetrics.indexedAssets.toString()} />
                    <StatCard label="Profiled assets" value={dynamicMetrics.profiledAssets.toString()} />
                    <StatCard label="Script beats" value={dynamicMetrics.beatCount.toString()} />
                    <StatCard label="Assigned beats" value={dynamicMetrics.assignedBeats.toString()} />
                  </>
                ) : null}
              </div>
              <div className="rounded-3xl border border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
                {previewPlan?.mode === "append"
                  ? "Placements will be appended after the current end of the target track."
                  : previewPlan?.mode === "sequence_in_out"
                    ? `Resolved no-gap coverage inside ${formatSeconds(previewPlan.rangeStartSec)} - ${formatSeconds(previewPlan.rangeEndSec)}. Premiere receives final times, so it will not trim these clips again.`
                    : previewPlan?.mode === "whole_sequence"
                      ? "Whole-sequence fallback is active because sequence In/Out is not being used."
                      : "Set sequence In/Out or enable whole-sequence fallback to make the preview executable."}
              </div>
              <div className="rounded-3xl border border-border/70 bg-background/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Missing Asset Plan</p>
                    <h3 className="mt-2 text-base font-semibold">Prompt Plan</h3>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                      Draft briefs for weak, blank, or generated-ready moments. Nothing is generated or imported yet.
                    </p>
                  </div>
                  <StatusPill
                    tone={missingAssetPlan.prompts.length > 0 ? "warning" : "success"}
                    label={`${missingAssetPlan.prompts.length} prompts`}
                  />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <StatusCard label="Prompt count" value={missingAssetPlan.prompts.length.toString()} />
                  <StatusCard label="High priority" value={missingAssetPlan.highPriorityCount.toString()} />
                  <StatusCard
                    label="Top type"
                    value={
                      missingAssetPlan.prompts.length
                        ? formatTopPromptType(missingAssetPlan)
                      : "No missing assets"
                    }
                  />
                  <StatusCard
                    label="Prompt source"
                    value={
                      promptRefinementResult?.refinedCount
                        ? `AI-refined ${promptRefinementResult.refinedCount} via ${formatProviderName(promptRefinementResult.providerUsed)}`
                        : "Rule-generated"
                    }
                  />
                </div>
                {missingAssetPlan.prompts.length > 0 ? (
                  <>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleRefinePromptPlan()}
                        disabled={Boolean(promptRefineBusyMessage) || aiMode === "off"}
                        className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {promptRefineBusyMessage ?? "Refine prompts with AI"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCopyAllPrompts()}
                        className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
                      >
                        Copy all prompts
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportPromptBrief("md")}
                        className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
                      >
                        Export MD
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportPromptBrief("txt")}
                        className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
                      >
                        Export TXT
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportPromptBrief("json")}
                        className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
                      >
                        Export JSON
                      </button>
                      {refinedMissingAssetPlan ? (
                        <button
                          type="button"
                          onClick={handleResetAllPrompts}
                          className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent"
                        >
                          Reset all to rules
                        </button>
                      ) : null}
                    </div>
                    {aiMode === "off" ? (
                      <InlineMessage
                        tone="warning"
                        message="Turn AI mode to Local or Hybrid to refine prompts. Rule-generated prompts remain available."
                      />
                    ) : null}
                    {promptRefinementResult?.errors.length ? (
                      <InlineMessage
                        tone="warning"
                        message={`Prompt refinement kept safe fallbacks: ${promptRefinementResult.errors.slice(0, 2).join(" | ")}`}
                      />
                    ) : null}
                    <div className="mt-4 max-h-[360px] space-y-3 overflow-auto">
                      {missingAssetPlan.prompts.map((prompt) => {
                        const linkedAssets = assetsByPromptId.get(prompt.id) ?? [];
                        const draft = assetDraftsByPromptId[prompt.id] ?? {
                          filePath: "",
                          sourceTool: "Manual",
                          notes: "",
                        };

                        return (
                          <article
                          key={prompt.id}
                          className="rounded-2xl border border-border/70 bg-card/60 p-3 text-sm"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <StatusPill
                              tone={prompt.priority === "high" ? "warning" : "info"}
                              label={`${prompt.priority} / ${prompt.suggestedAssetType}`}
                            />
                            <span className="font-mono text-xs text-muted-foreground">
                              {formatSeconds(prompt.startSec)} - {formatSeconds(prompt.endSec)}
                            </span>
                          </div>
                          <p className="mt-3 text-sm leading-6 text-foreground">{prompt.transcriptText}</p>
                          <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                            <SummaryRow label="Need" value={prompt.usage} />
                            <SummaryRow label="Tool" value={prompt.suggestedToolCategory} />
                            <SummaryRow label="Role" value={formatEditorialRole(prompt.editorialRole)} />
                            <SummaryRow label="Mode" value={prompt.visualMode} />
                          </div>
                          {linkedAssets.length > 0 ? (
                            <div className="mt-3 space-y-2 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs">
                              {linkedAssets.map((asset) => (
                                <div key={asset.id} className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-emerald-100">
                                    {asset.fileName} / {asset.status} / {asset.sourceTool}
                                    {appliedGeneratedAssetIdsByPlacementId[asset.linkedPlacementId] === asset.id ? " / in plan" : ""}
                                  </span>
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateGeneratedAssetStatus(asset.id, "approved")}
                                      className="rounded-full border border-emerald-300/30 px-2 py-1 hover:bg-emerald-300/10"
                                    >
                                      Approve
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateGeneratedAssetStatus(asset.id, "rejected")}
                                      className="rounded-full border border-emerald-300/30 px-2 py-1 hover:bg-emerald-300/10"
                                    >
                                      Reject
                                    </button>
                                    {appliedGeneratedAssetIdsByPlacementId[asset.linkedPlacementId] === asset.id ? (
                                      <button
                                        type="button"
                                        onClick={() => handleRestoreGeneratedAssetPlacement(asset.linkedPlacementId)}
                                        className="rounded-full border border-emerald-300/30 px-2 py-1 hover:bg-emerald-300/10"
                                      >
                                        Remove from plan
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => handleUseGeneratedAssetInPlan(asset)}
                                        disabled={asset.status !== "approved"}
                                        className="rounded-full border border-emerald-300/30 px-2 py-1 hover:bg-emerald-300/10 disabled:opacity-50"
                                      >
                                        Use in plan
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          <p className="mt-3 text-xs leading-5 text-amber-300">{prompt.reason}</p>
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">
                            Source:{" "}
                            <span className="text-foreground">
                              {prompt.aiRefined
                                ? `AI-refined via ${formatProviderName(prompt.refinementProvider ?? null)}`
                                : "rule-generated"}
                            </span>
                            {prompt.refinementNote ? ` - ${prompt.refinementNote}` : ""}
                          </p>
                          <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">
                            {prompt.promptText}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void handleCopyPrompt(prompt.id)}
                              className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
                            >
                              {copiedPromptIds[prompt.id] ? "Copied" : "Copy prompt"}
                            </button>
                            {prompt.aiRefined ? (
                              <button
                                type="button"
                                onClick={() => handleResetPrompt(prompt.id)}
                                className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
                              >
                                Reset to rule prompt
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() =>
                                setActiveAttachPromptId((current) =>
                                  current === prompt.id ? null : prompt.id,
                                )
                              }
                              className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
                            >
                              Attach generated asset
                            </button>
                          </div>
                          {activeAttachPromptId === prompt.id ? (
                            <div className="mt-3 grid gap-3 rounded-2xl border border-border/70 bg-background/50 p-3 text-xs">
                              <label className="grid gap-1">
                                <span className="text-muted-foreground">Local file path</span>
                                <input
                                  value={draft.filePath}
                                  onChange={(event) =>
                                    handleAttachDraftChange(prompt.id, { filePath: event.target.value })
                                  }
                                  placeholder="H:\\Generated\\money-dashboard-shot.mp4"
                                  className="rounded-xl border border-border/70 bg-card px-3 py-2 outline-none transition focus:border-primary"
                                />
                              </label>
                              <div className="grid gap-3 md:grid-cols-2">
                                <label className="grid gap-1">
                                  <span className="text-muted-foreground">Source tool / provider</span>
                                  <input
                                    value={draft.sourceTool}
                                    onChange={(event) =>
                                      handleAttachDraftChange(prompt.id, { sourceTool: event.target.value })
                                    }
                                    placeholder="Kling, Seedance, Runway, Manual, Other"
                                    className="rounded-xl border border-border/70 bg-card px-3 py-2 outline-none transition focus:border-primary"
                                  />
                                </label>
                                <label className="grid gap-1">
                                  <span className="text-muted-foreground">Notes</span>
                                  <input
                                    value={draft.notes}
                                    onChange={(event) =>
                                      handleAttachDraftChange(prompt.id, { notes: event.target.value })
                                    }
                                    placeholder="Good take, needs review, alpha pass..."
                                    className="rounded-xl border border-border/70 bg-card px-3 py-2 outline-none transition focus:border-primary"
                                  />
                                </label>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleAttachGeneratedAsset(prompt.id)}
                                disabled={!draft.filePath.trim()}
                                className="w-fit rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Link asset to prompt
                              </button>
                            </div>
                          ) : null}
                        </article>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">
                    No prompt briefs needed for this preview. Strong local matches can go straight to review.
                  </p>
                )}
              </div>
              <div className="rounded-3xl border border-border/70 bg-background/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Asset Inbox</p>
                    <h3 className="mt-2 text-base font-semibold">Generated Asset Inbox</h3>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                      Manually link generated files back to prompt ids now; future automation can write the same records.
                    </p>
                  </div>
                  <StatusPill tone={generatedAssets.length > 0 ? "info" : "success"} label={`${generatedAssets.length} assets`} />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <StatusCard label="Imported" value={generatedAssets.length.toString()} />
                  <StatusCard
                    label="Approved"
                    value={generatedAssets.filter((asset) => asset.status === "approved").length.toString()}
                  />
                  <StatusCard
                    label="Ready later"
                    value="Manual linking only"
                  />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleUseAllApprovedAssetsInPlan}
                    disabled={!effectivePlan || generatedAssets.every((asset) => asset.status !== "approved")}
                    className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Use all approved assets in plan
                  </button>
                  <button
                    type="button"
                    onClick={handleRestoreAllGeneratedAssetPlacements}
                    disabled={Object.keys(appliedGeneratedAssetIdsByPlacementId).length === 0}
                    className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
                  >
                    Restore original placements
                  </button>
                  <select
                    value={assetStatusFilter}
                    onChange={(event) =>
                      setAssetStatusFilter(event.target.value as typeof assetStatusFilter)
                    }
                    className="rounded-full border border-border/70 bg-card px-3 py-2 text-sm"
                  >
                    <option value="all">All statuses</option>
                    <option value="imported">Imported</option>
                    <option value="reviewed">Reviewed</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  <select
                    value={assetTypeFilter}
                    onChange={(event) =>
                      setAssetTypeFilter(event.target.value as typeof assetTypeFilter)
                    }
                    className="rounded-full border border-border/70 bg-card px-3 py-2 text-sm"
                  >
                    <option value="all">All types</option>
                    <option value="image">Image</option>
                    <option value="video">Video</option>
                    <option value="audio">Audio</option>
                    <option value="alpha">Alpha</option>
                    <option value="other">Other</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => handleExportAssetInbox("json")}
                    disabled={generatedAssets.length === 0}
                    className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
                  >
                    Export JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportAssetInbox("csv")}
                    disabled={generatedAssets.length === 0}
                    className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
                  >
                    Export CSV
                  </button>
                </div>
                {generatedAssetApplySummary ? (
                  <InlineMessage
                    tone={generatedAssetApplySummary.skippedCount > 0 ? "warning" : "success"}
                    message={`Generated asset plan update: ${generatedAssetApplySummary.updatedCount} updated, ${generatedAssetApplySummary.skippedCount} skipped${
                      generatedAssetApplySummary.skippedReasons.length
                        ? `. ${generatedAssetApplySummary.skippedReasons.slice(0, 2).join(" | ")}`
                        : "."
                    }`}
                  />
                ) : null}
                {filteredGeneratedAssets.length > 0 ? (
                  <div className="mt-4 max-h-[300px] space-y-3 overflow-auto">
                    {filteredGeneratedAssets.map((asset) => {
                      const isApplied = appliedGeneratedAssetIdsByPlacementId[asset.linkedPlacementId] === asset.id;

                      return (
                        <article key={asset.id} className="rounded-2xl border border-border/70 bg-card/60 p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <StatusPill
                            tone={asset.status === "approved" ? "success" : asset.status === "rejected" ? "warning" : "info"}
                            label={`${asset.fileType} / ${asset.status}${isApplied ? " / in plan" : ""}`}
                          />
                          <span className="font-mono text-xs text-muted-foreground">
                            {formatSeconds(asset.timestampStartSec)} - {formatSeconds(asset.timestampEndSec)}
                          </span>
                        </div>
                        <p className="mt-3 font-medium text-foreground">{asset.fileName}</p>
                        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{asset.filePath}</p>
                          <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                            <SummaryRow label="Prompt" value={asset.linkedPromptId} />
                            <SummaryRow label="Source" value={asset.sourceTool} />
                            <SummaryRow label="Usage" value={asset.intendedUsage} />
                            <SummaryRow label="Requested" value={asset.requestedAssetType} />
                            <SummaryRow
                              label="Duration"
                              value={
                                asset.sourceDurationSec
                                  ? formatSeconds(asset.sourceDurationSec)
                                  : asset.durationProbeStatus ?? "not probed"
                              }
                            />
                            <SummaryRow label="Probe" value={asset.durationProbeNote ?? "No duration metadata"} />
                          </div>
                        {asset.notes ? <p className="mt-3 text-xs text-muted-foreground">{asset.notes}</p> : null}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleCopyGeneratedAssetPath(asset)}
                            className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
                          >
                            Copy path
                          </button>
                          {asset.fileType === "video" ? (
                            <button
                              type="button"
                              onClick={() => handleProbeGeneratedAssetDuration(asset.id)}
                              className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
                            >
                              Refresh metadata
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => handleUpdateGeneratedAssetStatus(asset.id, "reviewed")}
                            className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
                          >
                            Mark reviewed
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateGeneratedAssetStatus(asset.id, "approved")}
                            className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateGeneratedAssetStatus(asset.id, "rejected")}
                            className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
                          >
                            Reject
                          </button>
                          {isApplied ? (
                            <button
                              type="button"
                              onClick={() => handleRestoreGeneratedAssetPlacement(asset.linkedPlacementId)}
                              className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
                            >
                              Remove from plan
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleUseGeneratedAssetInPlan(asset)}
                              disabled={asset.status !== "approved"}
                              className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
                            >
                              Use in plan
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleUnlinkGeneratedAsset(asset.id)}
                            className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
                          >
                            Unlink
                          </button>
                        </div>
                      </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">
                    No generated assets match the current filters. Attach one from a prompt card when a file is ready.
                  </p>
                )}
                <InlineMessage
                  tone="info"
                  message="Approved generated assets are organized here for future replanning. This phase does not auto-replace timeline placements."
                />
              </div>
              <div className="max-h-[460px] space-y-3 overflow-auto">
                {previewPlan?.placements.slice(0, 30).map((placement) => {
                  const prompt = promptByPlacementId.get(placement.id);
                  const linkedAssets = assetsByPlacementId.get(placement.id) ?? [];

                  return (
                    <article
                    key={placement.id}
                    className="rounded-3xl border border-border/70 bg-background/60 p-4"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <StatusPill
                        tone={
                          placement.strategy === "ai"
                            ? "info"
                            : placement.strategy === "manual"
                              ? "success"
                              : placement.strategy === "fallback"
                                ? "warning"
                              : "warning"
                        }
                        label={
                          placement.lowConfidence
                            ? "low-confidence fallback"
                            : placement.strategy === "manual"
                              ? "manual"
                              : placement.strategy
                        }
                      />
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatSeconds(placement.startSec)} - {formatSeconds(placement.endSec)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-foreground">{placement.text}</p>
                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                      <SummaryRow
                        label="Media"
                        value={placement.mediaName ? `${placement.mediaType ?? "media"} / ${placement.mediaName}` : "blank gap"}
                      />
                      <SummaryRow
                        label="Duration"
                        value={`${placement.durationSec.toFixed(2)}s${placement.layerIndex > 0 ? ` / overlap V+${placement.layerIndex}` : ""}`}
                      />
                      <SummaryRow label="Role" value={formatEditorialRole(placement.editorialRole)} />
                      <SummaryRow label="Strategy" value={formatPlacementStrategy(placement.strategy, placement.lowConfidence)} />
                      <SummaryRow label="Provider" value={formatProviderName(placement.aiProvider)} />
                      <SummaryRow label="Confidence" value={`${Math.round(placement.aiConfidence * 100)}%`} />
                      <SummaryRow label="Match" value={formatMatchKind(placement.matchKind)} />
                      <SummaryRow label="Preference" value={placement.mediaPreference ?? "either"} />
                      {placement.usingGeneratedAsset ? (
                        <>
                          <SummaryRow label="Generated" value={placement.generatedAssetSource ?? "approved asset"} />
                          <SummaryRow label="Original" value={placement.originalMediaName ?? placement.originalStrategy ?? "blank"} />
                        </>
                      ) : null}
                      <SummaryRow
                        label="Recipe"
                        value={`${getOptionLabel(EDIT_STYLE_OPTIONS, editStyle)} / ${getOptionLabel(BROLL_STYLE_OPTIONS, brollStyle)}`}
                      />
                      <SummaryRow label="Captions" value={getOptionLabel(CAPTION_STYLE_OPTIONS, captionStyle)} />
                      {placement.mediaType === "video" ? (
                        <>
                          <SummaryRow
                            label="Source"
                            value={
                              placement.sourceDurationSec
                                ? `${formatSeconds(placement.sourceDurationSec)} total`
                                : "duration unknown"
                            }
                          />
                          <SummaryRow
                            label="Source range"
                            value={
                              placement.sourceInSec !== null && placement.sourceOutSec !== null
                                ? `${formatSeconds(placement.sourceInSec)} - ${formatSeconds(placement.sourceOutSec)}`
                                : "not trimmed"
                            }
                          />
                        </>
                      ) : null}
                    </div>
                    <div className="mt-3 space-y-2 rounded-2xl border border-border/70 bg-card/60 p-3 text-xs">
                      {placement.aiRationale ? (
                        <p className="leading-5 text-muted-foreground">
                          <span className="text-foreground">Match:</span> {placement.aiRationale}
                        </p>
                      ) : null}
                      {placement.timingRationale ? (
                        <p className="leading-5 text-muted-foreground">
                          <span className="text-foreground">Timing:</span> {placement.timingSource} - {placement.timingRationale}
                        </p>
                      ) : null}
                      {placement.aiVisualMatchReason ? (
                        <p className="leading-5 text-muted-foreground">
                          <span className="text-foreground">Visual fit:</span> {placement.aiVisualMatchReason}
                        </p>
                      ) : null}
                      {placement.trimNote ? (
                        <p className="leading-5 text-muted-foreground">
                          <span className="text-foreground">Trim:</span> {placement.trimNote}
                        </p>
                      ) : null}
                      {placement.fallbackReason ? (
                        <p className="leading-5 text-amber-300">{placement.fallbackReason}</p>
                      ) : null}
                      {placement.usingGeneratedAsset ? (
                        <p className="leading-5 text-emerald-300">
                          Using approved generated asset: {placement.generatedAssetRationale}
                        </p>
                      ) : null}
                      {placement.lowConfidence ? (
                        <p className="leading-5 text-amber-300">
                          Review this placement before executing; it is below the current confidence threshold.
                        </p>
                      ) : null}
                      {prompt ? (
                        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
                          <p className="font-medium text-amber-200">
                            Prompt recommended: {prompt.suggestedAssetType} / {prompt.priority}
                          </p>
                          <p className="mt-1 leading-5 text-amber-100/80">{prompt.reason}</p>
                          <p className="mt-1 leading-5 text-amber-100/70">
                            {prompt.aiRefined
                              ? `AI-refined via ${formatProviderName(prompt.refinementProvider ?? null)}`
                              : "Rule-generated prompt"}
                          </p>
                          <button
                            type="button"
                            onClick={() => void handleCopyPrompt(prompt.id)}
                            className="mt-2 rounded-full border border-amber-300/30 px-3 py-1 hover:bg-amber-300/10"
                          >
                            {copiedPromptIds[prompt.id] ? "Copied prompt" : "Copy prompt"}
                          </button>
                        </div>
                      ) : null}
                      {linkedAssets.length > 0 ? (
                        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
                          <p className="font-medium text-emerald-200">Generated asset linked</p>
                          <div className="mt-2 space-y-2">
                            {linkedAssets.map((asset) => (
                              <div key={asset.id}>
                                <p className="text-emerald-100">
                                  {asset.fileName} / {asset.status} / {asset.sourceTool}
                                </p>
                                <p className="mt-1 text-emerald-100/70">
                                  {asset.intendedUsage}
                                  {asset.sourceDurationSec ? ` / ${formatSeconds(asset.sourceDurationSec)} source` : " / duration unknown"}
                                  {placement.generatedAssetId === asset.id
                                    ? " / currently used in plan"
                                    : asset.status === "approved"
                                      ? " / ready for generated-asset replanning"
                                      : ""}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="hidden">
                      <span>
                        {placement.mediaName
                          ? `[${placement.mediaType}] ${placement.mediaName}`
                          : "blank gap"}
                      </span>
                      <span>
                        {placement.durationSec.toFixed(2)}s
                        {placement.layerIndex > 0 ? ` • overlap layer ${placement.layerIndex + 1}` : ""}
                      </span>
                    </div>
                    {placement.aiProvider ? (
                      <p className="hidden">
                        AI {placement.aiProvider} {(placement.aiConfidence * 100).toFixed(0)}%{" "}
                        {placement.aiRationale ? `- ${placement.aiRationale}` : ""}
                      </p>
                    ) : null}
                    {placement.timingRationale ? (
                      <p className="hidden">
                        Timing {placement.timingSource}: {placement.timingRationale}
                      </p>
                    ) : null}
                    {placement.fallbackReason ? (
                      <p className="hidden">{placement.fallbackReason}</p>
                    ) : null}
                    {showAdvancedUi ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setManualOverridesBySegmentId((previous) => ({
                              ...previous,
                              [placement.segmentId]: "auto",
                            }))
                          }
                          className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
                        >
                          Auto
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setManualOverridesBySegmentId((previous) => ({
                              ...previous,
                              [placement.segmentId]: "blank",
                            }))
                          }
                          className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
                        >
                          Blank
                        </button>
                        {aiRankingsBySegmentId[placement.segmentId]?.rankedAssets?.[0] ? (
                          <button
                            type="button"
                            onClick={() =>
                              setManualOverridesBySegmentId((previous) => ({
                                ...previous,
                                [placement.segmentId]:
                                  aiRankingsBySegmentId[placement.segmentId].rankedAssets[0].candidateId,
                              }))
                            }
                            className="rounded-full border border-border/70 px-3 py-1 text-xs hover:bg-accent"
                          >
                            Use AI top
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    </article>
                  );
                })}
                {!effectivePlan ? (
                  <div className="rounded-3xl border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
                    Add a valid script and media folder to build the preview.
                  </div>
                ) : null}
              </div>
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => void handlePlaceOnTimeline()}
                  disabled={!canExecute}
                  className="w-full rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busyMessage ?? "Place on timeline"}
                </button>
                {executeReason ? <InlineMessage tone="warning" message={executeReason} /> : null}
                {aiErrors.length > 0 ? (
                  <InlineMessage tone="warning" message={`AI errors: ${aiErrors.slice(0, 2).join(" | ")}`} />
                ) : null}
              </div>
              {result ? (
                <div className="rounded-3xl border border-border/70 bg-background/60 p-4 text-sm">
                  <p className={result.ok ? "text-emerald-400" : "text-destructive"}>
                    {result.message}
                  </p>
                  <p className="mt-3 text-muted-foreground">
                    Placed {result.placedCount}, blanked {result.blankCount}, skipped{" "}
                    {result.skippedCount}, clipped {result.clippedCount}, imported{" "}
                    {result.importedCount}.
                  </p>
                  {result.workingRangeEndSec > result.workingRangeStartSec ? (
                    <p className="mt-2 text-muted-foreground">
                      Working range {formatSeconds(result.workingRangeStartSec)} -{" "}
                      {formatSeconds(result.workingRangeEndSec)}.
                    </p>
                  ) : null}
                  {result.details?.length ? (
                    <div className="mt-3 space-y-1 font-mono text-xs text-muted-foreground">
                      {result.details.slice(0, 10).map((detail) => (
                        <p key={detail}>{detail}</p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </PanelSection>
          </div>
        </section>
      </div>
    </main>
  );
};

function loadStoredSettings(): Partial<StoredSettings> | null {
  try {
    const current = window.localStorage.getItem(STORAGE_KEY);
    if (current) {
      return JSON.parse(current) as Partial<StoredSettings>;
    }

    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) {
      return null;
    }

    return JSON.parse(legacy) as Partial<StoredSettings>;
  } catch {
    return null;
  }
}

function shortlistCandidates(
  text: string,
  mediaItems: MediaLibraryItem[],
  limit: number,
): MediaLibraryItem[] {
  if (mediaItems.length <= Math.max(limit, 48)) {
    return mediaItems;
  }

  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return sampleCandidatePool(mediaItems, limit);
  }

  const scored = mediaItems
    .map((item) => {
      const normalizedName = getFileName(item.path).toLowerCase();
      let score = 0;
      tokens.forEach((token) => {
        if (normalizedName.includes(token)) {
          score += 1;
        }
      });
      return { item, score };
    })
    .sort((left, right) => right.score - left.score || left.item.path.localeCompare(right.item.path));

  const prioritized = scored.filter((entry) => entry.score > 0).map((entry) => entry.item);
  const fallback = scored.filter((entry) => entry.score === 0).map((entry) => entry.item);
  const sampledFallback = sampleCandidatePool(fallback, Math.max(0, limit - prioritized.length));
  return dedupeMediaItems([...prioritized.slice(0, limit), ...sampledFallback]).slice(0, limit);
}

function formatMarkerTranscript(segments: PremiereTranscriptSegment[]): string {
  return segments
    .map((segment) =>
      segment.endSec && segment.endSec > segment.startSec
        ? `${formatSeconds(segment.startSec)} --> ${formatSeconds(segment.endSec)} ${segment.text}`
        : `${formatSeconds(segment.startSec)} ${segment.text}`,
    )
    .join("\n\n");
}

function buildFullScriptContext(segments: ScriptSegment[]): string {
  const totalDuration =
    segments.length > 0
      ? (segments[segments.length - 1].endSec ?? segments[segments.length - 1].startSec) - segments[0].startSec
      : 0;
  const scriptPreview = segments
    .map((segment, index) => `${index + 1}. ${segment.text}`)
    .join(" ")
    .slice(0, 1800);

  return [
    `Segments: ${segments.length}.`,
    totalDuration > 0 ? `Transcript span: ${totalDuration.toFixed(2)} seconds.` : "",
    `Story preview: ${scriptPreview}`,
  ]
    .filter(Boolean)
    .join(" ");
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function sampleCandidatePool(mediaItems: MediaLibraryItem[], limit: number): MediaLibraryItem[] {
  if (mediaItems.length <= limit) {
    return mediaItems;
  }

  const stride = Math.max(1, Math.floor(mediaItems.length / limit));
  const sampled: MediaLibraryItem[] = [];

  for (let index = 0; index < mediaItems.length && sampled.length < limit; index += stride) {
    sampled.push(mediaItems[index]);
  }

  return sampled.slice(0, limit);
}

function dedupeMediaItems(items: MediaLibraryItem[]): MediaLibraryItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.path)) {
      return false;
    }

    seen.add(item.path);
    return true;
  });
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function downloadTextFile(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function generatedAssetPathExists(filePath: string): boolean | null {
  if (!isNodeEnabled()) {
    return null;
  }

  try {
    const nodeRequire = window.require as (moduleName: string) => unknown;
    const fs = nodeRequire("fs") as { existsSync: (path: string) => boolean };
    return fs.existsSync(filePath);
  } catch {
    return null;
  }
}

function probeGeneratedAssetDurationMetadata(filePath: string): {
  sourceDurationSec?: number;
  durationProbeStatus: ImportedGeneratedAsset["durationProbeStatus"];
  durationProbeNote: string;
} {
  const lowered = filePath.toLowerCase();
  if (!/\.(mp4|mov|m4v|avi|mkv|webm)$/.test(lowered)) {
    return {
      durationProbeStatus: "not_probed",
      durationProbeNote: "Duration probing is only needed for generated video assets.",
    };
  }

  const exists = generatedAssetPathExists(filePath);
  if (exists === false) {
    return {
      durationProbeStatus: "failed",
      durationProbeNote: "File path does not exist; duration was not probed.",
    };
  }

  return probeVideoDuration(filePath);
}

function formatTopPromptType(plan: MissingAssetPlan): string {
  const [type, count] = Object.entries(plan.byType).sort((left, right) => right[1] - left[1])[0] ?? ["image", 0];
  return count > 0 ? `${type} (${count})` : "No missing assets";
}

function getOptionLabel<T extends string>(options: Array<{ value: T; label: string }>, value: T): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function scanLibraryFolder(folderPath: string, mode: MediaLibraryMode, sortMode: MediaSortMode): MediaScanResult {
  try {
    return listMediaFiles(folderPath, mode, sortMode);
  } catch (error) {
    return {
      items: [],
      warnings: [`Scan failed: ${String(error)}`],
    };
  }
}

function clampDurationInput(value: number, min: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.round(value * 100) / 100);
}

function clampVariationStrength(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_DYNAMIC_EDITOR_SETTINGS.variationStrength;
  }

  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

function applyWorkingRange(
  placements: TimelinePlacement[],
  rangeStartSec: number,
  rangeEndSec: number,
): { placements: TimelinePlacement[]; skippedCount: number; clippedCount: number } {
  const result: TimelinePlacement[] = [];
  let skippedCount = 0;
  let clippedCount = 0;

  placements.forEach((placement) => {
    if (placement.endSec <= rangeStartSec || placement.startSec >= rangeEndSec) {
      skippedCount += 1;
      return;
    }

    const nextStart = Math.max(placement.startSec, rangeStartSec);
    const nextEnd = Math.min(placement.endSec, rangeEndSec);

    if (nextStart !== placement.startSec || nextEnd !== placement.endSec) {
      clippedCount += 1;
    }

    const trimOffsetSec = Math.max(0, nextStart - placement.startSec);
    const nextDurationSec = Math.max(0, Math.round((nextEnd - nextStart) * 100) / 100);
    const nextSourceInSec =
      placement.sourceInSec !== null ? Math.round((placement.sourceInSec + trimOffsetSec) * 100) / 100 : null;
    const nextSourceOutSec =
      nextSourceInSec !== null && placement.sourceOutSec !== null
        ? Math.round(Math.min(placement.sourceOutSec, nextSourceInSec + nextDurationSec) * 100) / 100
        : placement.sourceOutSec;

    result.push({
      ...placement,
      startSec: nextStart,
      endSec: nextEnd,
      durationSec: nextDurationSec,
      sourceInSec: nextSourceInSec,
      sourceOutSec: nextSourceOutSec,
    });
  });

  return { placements: result, skippedCount, clippedCount };
}

function formatProviderName(provider: string | null): string {
  if (!provider) {
    return "deterministic";
  }

  return provider
    .split("+")
    .map((name) =>
      name === "ollama"
        ? "Gemma/Ollama"
        : name === "gemini"
          ? "Gemini fallback"
          : name === "heuristic"
            ? "deterministic"
            : name,
    )
    .join(" + ");
}

function formatPlacementStrategy(
  strategy: TimelinePlacement["strategy"],
  lowConfidence: boolean,
): string {
  if (lowConfidence) {
    return "review fallback";
  }

  if (strategy === "ai") {
    return "AI selected";
  }

  if (strategy === "manual") {
    return "manual";
  }

  if (strategy === "generated") {
    return "approved generated";
  }

  return strategy;
}

function formatEditorialRole(role: TimelinePlacement["editorialRole"]): string {
  switch (role) {
    case "cta":
      return "CTA";
    case "hook":
      return "hook";
    case "proof":
      return "proof";
    case "transition":
      return "transition";
    case "explanation":
      return "explanation";
    default:
      return "general";
  }
}

function formatMatchKind(kind: TimelinePlacement["matchKind"]): string {
  if (!kind) {
    return "not scored";
  }

  if (kind === "style") {
    return "style/mood";
  }

  return kind;
}

function PanelSection({
  step,
  title,
  description,
  action,
  children,
}: {
  step: string;
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-border/70 bg-card/95 p-6 shadow-xl shadow-black/10">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Step {step}</p>
            <h2 className="mt-2 text-xl font-semibold">{title}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
          {action}
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </section>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "warning" | "info";
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : tone === "info"
        ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
        : "border-amber-500/30 bg-amber-500/10 text-amber-300";

  return <span className={`${statusPillBase} ${toneClass}`}>{label}</span>;
}

function InlineMessage({
  message,
  tone,
}: {
  message: string;
  tone: "error" | "warning" | "neutral";
}) {
  const toneClass =
    tone === "error"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : tone === "warning"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
        : "border-border/70 bg-background/50 text-muted-foreground";

  return <div className={`rounded-2xl border px-4 py-3 text-sm ${toneClass}`}>{message}</div>;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-border/70 bg-background/60 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-border/70 bg-background/60 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-medium leading-6 text-foreground">{value}</p>
    </div>
  );
}

function DirectionSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="text-sm">
      <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="mt-2 w-full rounded-2xl border border-border/70 bg-card px-3 py-2 outline-none transition focus:border-primary"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="rounded-3xl border border-border/70 bg-background/60 p-4 text-sm">
      <span className="block text-xs uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(clampDurationInput(Number(event.target.value), min))}
        className="mt-2 w-full rounded-2xl border border-border/70 bg-card px-3 py-2 outline-none transition focus:border-primary"
      />
    </label>
  );
}

function TrackField({
  tracks,
  value,
  onChange,
}: {
  tracks: PremiereStatus["videoTracks"];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="rounded-3xl border border-border/70 bg-background/60 p-4 text-sm">
      <span className="block text-xs uppercase tracking-[0.18em] text-muted-foreground">
        Target video track
      </span>
      {tracks.length > 0 ? (
        <select
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="mt-2 w-full rounded-2xl border border-border/70 bg-card px-3 py-2 outline-none transition focus:border-primary"
        >
          {tracks.map((track) => (
            <option key={track.index} value={track.index + 1}>
              V{track.index + 1} • {track.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="number"
          min={1}
          step={1}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="mt-2 w-full rounded-2xl border border-border/70 bg-card px-3 py-2 outline-none transition focus:border-primary"
        />
      )}
    </label>
  );
}

function ToggleRow({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-3xl border border-border/70 bg-background/60 p-4 text-sm ${
        disabled ? "opacity-60" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1"
      />
      <span>
        <span className="block font-medium text-foreground">{label}</span>
        <span className="mt-1 block leading-6 text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

export default Index;
