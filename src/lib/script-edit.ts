import {
  ParseScriptOptions,
  ScriptSegment,
  formatSeconds,
  parseTimestampScript,
} from "./script-parser";

/**
 * Returns the script segment that contains `sec` (the playhead position). Falls back to the
 * nearest segment by start time when the playhead sits in a gap or before the first segment.
 */
export function findSegmentAtTime(segments: ScriptSegment[], sec: number): ScriptSegment | null {
  if (segments.length === 0) {
    return null;
  }

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const inferredEnd =
      segment.endSec ?? segments[index + 1]?.startSec ?? Number.POSITIVE_INFINITY;
    if (sec >= segment.startSec && sec < inferredEnd) {
      return segment;
    }
  }

  if (sec < segments[0].startSec) {
    return segments[0];
  }

  let nearest = segments[0];
  let bestDistance = Math.abs(sec - segments[0].startSec);
  for (const segment of segments) {
    const distance = Math.abs(sec - segment.startSec);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = segment;
    }
  }
  return nearest;
}

function srtTimecode(sec: number): string {
  // formatSeconds yields HH:MM:SS.mmm; SRT uses a comma before milliseconds.
  return formatSeconds(Math.max(0, sec)).replace(".", ",");
}

/**
 * Serializes segments back into blank-line-separated SRT blocks, the form that round-trips
 * cleanly through parseTimestampScript (a bare "start --> end text" line without blank-line
 * separators is otherwise swallowed as a single SRT block, merging every segment).
 */
export function serializeSegmentsToScript(segments: ScriptSegment[]): string {
  return segments
    .map((segment, index) => {
      const fallbackEnd = segments[index + 1]?.startSec ?? segment.startSec + 2;
      const end =
        segment.endSec != null && segment.endSec > segment.startSec ? segment.endSec : fallbackEnd;
      return `${index + 1}\n${srtTimecode(segment.startSec)} --> ${srtTimecode(end)}\n${segment.text.trim()}`;
    })
    .join("\n\n");
}

export interface ScriptEditRequest {
  /** Playhead position used to locate the target line. */
  atSec: number;
  /** Replacement text for the located line (already produced by the LLM/script-editor agent). */
  newText: string;
  /** "line" replaces the single segment at the playhead; "all" replaces the entire script. */
  scope?: "line" | "all";
}

export interface ScriptEditResult {
  scriptText: string;
  changedSegmentId: string | null;
  previousText: string | null;
}

/**
 * Applies an already-resolved edit to the script. For scope "line" it replaces the text of
 * the segment at the playhead; for scope "all" it replaces the whole document.
 */
export function applyScriptEdit(
  scriptText: string,
  request: ScriptEditRequest,
  options: ParseScriptOptions = {},
): ScriptEditResult {
  if (request.scope === "all") {
    return { scriptText: request.newText, changedSegmentId: null, previousText: scriptText };
  }

  const { segments } = parseTimestampScript(scriptText, options);
  const target = findSegmentAtTime(segments, request.atSec);
  if (!target) {
    return { scriptText, changedSegmentId: null, previousText: null };
  }

  const previousText = target.text;
  const updated = segments.map((segment) =>
    segment.id === target.id ? { ...segment, text: request.newText } : segment,
  );

  return {
    scriptText: serializeSegmentsToScript(updated),
    changedSegmentId: target.id,
    previousText,
  };
}
