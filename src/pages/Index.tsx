import { ChangeEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  ExecuteTimelineJobInput,
  MediaScanResult,
  PremiereTranscriptSegment,
  PremiereRunResult,
  PremiereStatus,
  executeTimelineJob,
  getEnvironmentVariable,
  getPremiereStatus,
  getPremiereTranscriptSegments,
  hasNativeFolderPicker,
  isCepEnvironment,
  isNodeEnabled,
  listMediaFiles,
  pickFolder,
} from "@/lib/cep";
import { detectVideoTooling, hydrateAiCandidates } from "@/lib/ai/video-preprocessing";
import { checkAiProviders, rankSegmentsWithAi } from "@/lib/ai/router";
import {
  AiHealthStatus,
  AiMode,
  AiScoringContext,
  AiSegmentRanking,
  AiSegmentRequest,
} from "@/lib/ai/types";
import { formatSeconds, parseTimestampScript } from "@/lib/script-parser";
import { TimelinePlacement, buildTimelinePlan } from "@/lib/timeline-plan";
import { MediaLibraryItem, MediaLibraryMode, getFileName, normalizePath } from "@/lib/media";

const STORAGE_KEY = "weave-edit-settings";
const LEGACY_STORAGE_KEY = "sora-genie-settings";
const statusPillBase =
  "inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]";

interface StoredSettings {
  scriptText: string;
  imageFolderPath: string;
  libraryMode: MediaLibraryMode;
  transcriptSourceMode: "upload" | "premiere-markers";
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
}

interface WorkingPlan {
  mode: "append" | "sequence_in_out" | "whole_sequence" | "missing_range";
  placements: TimelinePlacement[];
  skippedCount: number;
  clippedCount: number;
  rangeStartSec: number;
  rangeEndSec: number;
}

const defaultSettings: StoredSettings = {
  scriptText: "",
  imageFolderPath: "",
  libraryMode: "images",
  transcriptSourceMode: "premiere-markers",
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
};

const Index = () => {
  const [scriptText, setScriptText] = useState(defaultSettings.scriptText);
  const [scriptSourceName, setScriptSourceName] = useState("Paste script or load a file");
  const [imageFolderPath, setImageFolderPath] = useState(defaultSettings.imageFolderPath);
  const [libraryMode, setLibraryMode] = useState<MediaLibraryMode>(defaultSettings.libraryMode);
  const [transcriptSourceMode, setTranscriptSourceMode] = useState<"upload" | "premiere-markers">(
    defaultSettings.transcriptSourceMode,
  );
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
  const [hostStatus, setHostStatus] = useState<PremiereStatus | null>(null);
  const [result, setResult] = useState<PremiereRunResult | null>(null);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [aiBusyMessage, setAiBusyMessage] = useState<string | null>(null);
  const [aiHealth, setAiHealth] = useState<AiHealthStatus[]>([]);
  const [aiErrors, setAiErrors] = useState<string[]>([]);
  const [aiRankingsBySegmentId, setAiRankingsBySegmentId] = useState<
    Record<string, AiSegmentRanking>
  >({});
  const [manualOverridesBySegmentId, setManualOverridesBySegmentId] = useState<
    Record<string, string | "blank" | "auto">
  >({});

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
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        scriptText,
        imageFolderPath,
        libraryMode,
        transcriptSourceMode,
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
      } satisfies StoredSettings),
    );
  }, [
    appendAtTrackEnd,
    imageFolderPath,
    libraryMode,
    transcriptSourceMode,
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
  ]);

  useEffect(() => {
    if (!imageFolderPath || !isNodeEnabled()) {
      return;
    }

    applyScanResult(scanLibraryFolder(imageFolderPath, libraryMode));
  }, [applyScanResult, imageFolderPath, libraryMode]);

  useEffect(() => {
    setAiRankingsBySegmentId({});
    setManualOverridesBySegmentId({});
    setAiErrors([]);
  }, [scriptText, imageFolderPath, customInstructions]);

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
      maxOverlapLayers: 2,
    });
  }, [
    aiConfidenceThreshold,
    aiRankingsBySegmentId,
    mediaItems,
    manualOverridesBySegmentId,
    maxDurationSec,
    minDurationSec,
    parsedScriptState.result,
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
      };
    }

    const range = hostStatus?.range;
    if (range?.hasMeaningfulInOut) {
      const clipped = applyWorkingRange(basePlan.placements, range.inSec, range.outSec);
      return {
        mode: "sequence_in_out",
        placements: clipped.placements,
        skippedCount: clipped.skippedCount,
        clippedCount: clipped.clippedCount,
        rangeStartSec: range.inSec,
        rangeEndSec: range.outSec,
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
      };
    }

    return {
      mode: "missing_range",
      placements: basePlan.placements,
      skippedCount: 0,
      clippedCount: 0,
      rangeStartSec: 0,
      rangeEndSec: hostStatus?.range.sequenceEndSec ?? 0,
    };
  }, [appendAtTrackEnd, basePlan, hostStatus, useWholeSequenceFallback]);

  const previewStats = useMemo(() => {
    const placements = effectivePlan?.placements ?? [];

    return placements.reduce(
      (summary, placement) => {
        if (placement.strategy === "ai") {
          summary.ai += 1;
        } else if (placement.strategy === "fallback") {
          summary.fallback += 1;
        } else if (placement.strategy === "manual") {
          summary.manual += 1;
        } else {
          summary.blank += 1;
        }

        if (placement.layerIndex > 0) {
          summary.overlap += 1;
        }

        return summary;
      },
      { ai: 0, fallback: 0, manual: 0, overlap: 0, blank: 0 },
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

    if (!effectivePlan || effectivePlan.placements.length === 0) {
      return "No placements fall inside the current working range.";
    }

    if (effectivePlan.mode === "missing_range") {
      return "Set sequence In/Out marks or enable whole-sequence fallback.";
    }

    return null;
  }, [basePlan, effectivePlan, hostStatus]);

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
    }),
    [customInstructions, geminiApiKey, geminiModel, ollamaBaseUrl, ollamaModel, videoTooling],
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
    if (aiMode === "off" || !parsedScriptState.result || mediaItems.length === 0) {
      return;
    }

    setAiBusyMessage("Ranking segment assets");
    setAiErrors([]);

    try {
      const preprocessingWarnings: string[] = [];
      const segments = parsedScriptState.result.segments;
      const segmentRequests: AiSegmentRequest[] = [];

      // Sequential prep avoids dozens of parallel ffmpeg/ffprobe calls freezing the panel.
      for (let i = 0; i < segments.length; i += 1) {
        const segment = segments[i];
        setAiBusyMessage(`Preparing media for segment ${i + 1}/${segments.length}`);
        const shortlisted = shortlistCandidates(segment.text, mediaItems, 30);
        const hydrated = await hydrateAiCandidates(
          shortlisted.map((item) => ({
            id: normalizePath(item.path),
            path: item.path,
            name: getFileName(item.path),
            mediaType: item.type,
          })),
        );
        preprocessingWarnings.push(...hydrated.warnings);

        segmentRequests.push({
          segmentId: segment.id,
          text: segment.text,
          startSec: segment.startSec,
          endSec: segment.endSec,
          wordCount: segment.wordCount,
          sentenceCount: segment.sentenceCount,
          sentenceComplete: segment.sentenceComplete,
          maxRecommendations: 6,
          minDurationSec: Math.max(0.5, Math.min(minDurationSec, maxDurationSec)),
          maxDurationSec: Math.max(minDurationSec, maxDurationSec),
          customInstructions,
          allowOverlap: true,
          maxOverlapLayers: 2,
          transcriptSource: transcriptSourceMode,
          candidates: hydrated.candidates,
        });
      }

      const ranked = await rankSegmentsWithAi(segmentRequests, aiMode, aiContext, (done, total) => {
        setAiBusyMessage(`AI ranking segment ${done}/${total}`);
      });
      setAiRankingsBySegmentId(ranked.rankingsBySegmentId);
      const fallbackWarnings = segmentRequests.flatMap((request) =>
        request.candidates
          .filter((candidate) => candidate.mediaType === "video" && !candidate.visualPaths?.length)
          .map((candidate) => `Limited video analysis for ${candidate.name}; extracted frames were unavailable.`),
      );
      setAiErrors([...preprocessingWarnings, ...fallbackWarnings, ...ranked.errors]);
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

    applyScanResult(scanLibraryFolder(imageFolderPath, libraryMode));
  }

  async function handlePlaceOnTimeline() {
    if (!effectivePlan) {
      return;
    }

    setBusyMessage("Sending plan to Premiere");
    setResult(null);

    const payload: ExecuteTimelineJobInput = {
      targetVideoTrackIndex: Math.max(0, targetVideoTrack - 1),
      appendAtTrackEnd,
      useSequenceInOut: effectivePlan.mode === "sequence_in_out",
      rangeStartSec: effectivePlan.mode === "sequence_in_out" ? effectivePlan.rangeStartSec : null,
      rangeEndSec: effectivePlan.mode === "sequence_in_out" ? effectivePlan.rangeEndSec : null,
      placements: effectivePlan.placements.map((placement) => ({
        id: placement.id,
        groupId: placement.groupId,
        layerIndex: placement.layerIndex,
        trackOffset: placement.trackOffset,
        startSec: placement.startSec,
        endSec: placement.endSec,
        durationSec: placement.durationSec,
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
                Build visual coverage for a marked part of your edit. Weave Edit reads a manual
                timestamped script, scans an image or video folder, and places matching media on
                the selected track with sequence In/Out taking priority over whole-sequence timing.
              </p>
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
                value={`V${targetVideoTrack}${hostStatus?.videoTracks[targetVideoTrack - 1] ? ` • ${hostStatus.videoTracks[targetVideoTrack - 1].name}` : ""}`}
              />
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <div className="space-y-6">
            <PanelSection
              step="1"
              title="Script"
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
              title="Media library"
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
                <div className="rounded-3xl border border-border/70 bg-background/60 px-4 py-3 text-sm text-muted-foreground">
                  {imageFolderPath
                    ? `Current source folder: ${imageFolderPath}`
                    : "Choose a folder and Weave Edit will write it here, then scan the source library."}
                </div>
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
              {mediaItems.length > 0 ? (
                <div className="rounded-3xl border border-border/70 bg-background/60 p-4">
                  <p className="text-sm font-medium">First files</p>
                  <div className="mt-3 max-h-40 space-y-1 overflow-auto font-mono text-xs text-muted-foreground">
                    {mediaItems.slice(0, 12).map((item) => (
                      <p key={item.path}>
                        [{item.type}] {item.path}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
            </PanelSection>

            <PanelSection
              step="3"
              title="Range and placement"
              description="Sequence In/Out is the primary working window. AI now proposes duration and overlap by sentence, while the duration fields below act only as safety rails."
            >
              <div className="grid gap-4 md:grid-cols-3">
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
              <div className="grid gap-3">
                <ToggleRow
                  checked={appendAtTrackEnd}
                  onChange={setAppendAtTrackEnd}
                  label="Append after the current end of the target track"
                  description="Use this for your next batch when you want to continue later instead of working inside the current In/Out window."
                />
                <ToggleRow
                  checked={useWholeSequenceFallback}
                  onChange={setUseWholeSequenceFallback}
                  disabled={appendAtTrackEnd}
                  label="Allow whole-sequence fallback when no In/Out marks are set"
                  description="Keep this off if you want Weave Edit to require real editorial marks before placing anything."
                />
              </div>
              <div className="rounded-3xl border border-border/70 bg-background/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      AI story matching
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Gemma is the main local scorer. For videos, Weave Edit extracts local frame
                      samples with `ffmpeg` and aligns them to the script timestamps before
                      ranking.
                    </p>
                  </div>
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
                    disabled={aiMode === "off" || !parsedScriptState.result || mediaItems.length === 0}
                    className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
                  >
                    {aiBusyMessage === "Ranking segment assets" ? "Ranking..." : "Analyze with AI"}
                  </button>
                </div>
                <div className="mt-4 space-y-2">
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
                    effectivePlan?.mode === "sequence_in_out"
                      ? "Sequence In/Out priority"
                      : effectivePlan?.mode === "append"
                        ? "Append after track end"
                        : effectivePlan?.mode === "whole_sequence"
                          ? "Whole-sequence fallback"
                          : "Blocked until range is chosen"
                  }
                />
                <StatusCard
                  label="Timing engine"
                  value="AI and heuristic reviewers propose duration plus sequential clip count; min/max only clamp outliers."
                />
                <StatusCard
                  label="Overlap policy"
                  value="Long segments can split into multiple same-track clips; overlays are reserved for simultaneous coverage."
                />
              </div>
              {!appendAtTrackEnd && !hasMeaningfulInOut && !useWholeSequenceFallback ? (
                <InlineMessage
                  tone="warning"
                  message="Set sequence In/Out in Premiere, or enable whole-sequence fallback if you want placement without marks."
                />
              ) : null}
            </PanelSection>
          </div>

          <div className="space-y-6">
            <PanelSection
              step="4"
              title="Premiere status"
              description="The host script returns the active sequence, track endpoints, and whether In/Out marks are meaningful enough to drive placement."
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
                {hostStatus?.message ? (
                  <p className="mt-4 text-sm text-destructive">{hostStatus.message}</p>
                ) : null}
                {hostStatus?.videoTracks.length ? (
                  <div className="mt-4 space-y-2">
                    {hostStatus.videoTracks.map((track) => (
                      <div
                        key={track.index}
                        className="flex items-center justify-between rounded-2xl border border-border/70 px-3 py-2 text-sm"
                      >
                        <span>{track.name || `V${track.index + 1}`}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          end {formatSeconds(track.endSec)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </PanelSection>

            <PanelSection
              step="5"
              title="Preview and execute"
              description="Review only the placements that matter for the current working range, then send them to Premiere."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <StatCard label="Preview placements" value={(effectivePlan?.placements.length ?? 0).toString()} />
                <StatCard label="AI-assisted" value={(previewStats.ai ?? 0).toString()} />
                <StatCard label="Low-confidence fallback" value={previewStats.fallback.toString()} />
                <StatCard label="Manual overrides" value={previewStats.manual.toString()} />
                <StatCard label="Overlap layers" value={previewStats.overlap.toString()} />
                <StatCard label="Skipped by range" value={(effectivePlan?.skippedCount ?? 0).toString()} />
                <StatCard label="Clipped by range" value={(effectivePlan?.clippedCount ?? 0).toString()} />
              </div>
              <div className="rounded-3xl border border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
                {effectivePlan?.mode === "append"
                  ? "Placements will be appended after the current end of the target track."
                  : effectivePlan?.mode === "sequence_in_out"
                    ? `Only placements inside ${formatSeconds(effectivePlan.rangeStartSec)} - ${formatSeconds(effectivePlan.rangeEndSec)} will be sent; clear or widen In/Out to fill the whole script.`
                    : effectivePlan?.mode === "whole_sequence"
                      ? "Whole-sequence fallback is active because sequence In/Out is not being used."
                      : "Set sequence In/Out or enable whole-sequence fallback to make the preview executable."}
              </div>
              <div className="max-h-[460px] space-y-3 overflow-auto">
                {effectivePlan?.placements.slice(0, 30).map((placement) => (
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
                    <div className="mt-3 flex items-center justify-between gap-4 text-xs text-muted-foreground">
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
                      <p className="mt-2 text-xs text-muted-foreground">
                        AI {placement.aiProvider} {(placement.aiConfidence * 100).toFixed(0)}%{" "}
                        {placement.aiRationale ? `- ${placement.aiRationale}` : ""}
                      </p>
                    ) : null}
                    {placement.timingRationale ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Timing {placement.timingSource}: {placement.timingRationale}
                      </p>
                    ) : null}
                    {placement.fallbackReason ? (
                      <p className="mt-2 text-xs text-amber-300">{placement.fallbackReason}</p>
                    ) : null}
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
                  </article>
                ))}
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

function scanLibraryFolder(folderPath: string, mode: MediaLibraryMode): MediaScanResult {
  try {
    return listMediaFiles(folderPath, mode);
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

    result.push({
      ...placement,
      startSec: nextStart,
      endSec: nextEnd,
      durationSec: Math.max(0.3, Math.round((nextEnd - nextStart) * 100) / 100),
    });
  });

  return { placements: result, skippedCount, clippedCount };
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
