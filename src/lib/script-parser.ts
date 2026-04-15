export interface ScriptSegment {
  id: string;
  startSec: number;
  endSec: number | null;
  text: string;
}

export interface ParseScriptResult {
  format: "srt" | "timestamp-lines";
  segments: ScriptSegment[];
}

export interface ParseScriptOptions {
  fps?: number;
}

const RANGE_RE =
  /(\d{1,2}:\d{2}(?::\d{2}(?::\d{1,2}|[.,]\d{1,3})?)?)\s*-->\s*(\d{1,2}:\d{2}(?::\d{2}(?::\d{1,2}|[.,]\d{1,3})?)?)/;
const SINGLE_TIMESTAMP_RE = /^(\d{1,2}:\d{2}(?::\d{2}(?::\d{1,2}|[.,]\d{1,3})?)?)\s+(.+)$/;

export function parseTimestampScript(source: string, options: ParseScriptOptions = {}): ParseScriptResult {
  const input = source.trim();

  if (!input) {
    throw new Error("Add a timestamped script first.");
  }

  const srtSegments = parseSrt(input, options);
  if (srtSegments.length > 0) {
    return { format: "srt", segments: normalizeSegments(srtSegments) };
  }

  const lineSegments = parseTimestampLines(input, options);
  if (lineSegments.length > 0) {
    return { format: "timestamp-lines", segments: normalizeSegments(lineSegments) };
  }

  throw new Error(
    "Could not parse the script. Use SRT or lines that begin with timestamps like 00:00:12 text or 00:00:12 --> 00:00:18 text.",
  );
}

export function formatSeconds(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = Math.floor(safeSeconds % 60);
  const milliseconds = Math.round((safeSeconds - Math.floor(safeSeconds)) * 1000);

  return [
    hours.toString().padStart(2, "0"),
    minutes.toString().padStart(2, "0"),
    remainingSeconds.toString().padStart(2, "0"),
  ].join(":")
    .concat(".")
    .concat(milliseconds.toString().padStart(3, "0"));
}

function parseSrt(input: string, options: ParseScriptOptions): ScriptSegment[] {
  const blocks = input.split(/\r?\n\r?\n+/);
  const segments: ScriptSegment[] = [];

  for (const block of blocks) {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      continue;
    }

    const timingLineIndex = RANGE_RE.test(lines[0]) ? 0 : RANGE_RE.test(lines[1]) ? 1 : -1;

    if (timingLineIndex === -1) {
      continue;
    }

    const match = lines[timingLineIndex].match(RANGE_RE);
    if (!match) {
      continue;
    }

    const text = lines.slice(timingLineIndex + 1).join(" ").trim();
    if (!text) {
      continue;
    }

    segments.push({
      id: `segment-${segments.length + 1}`,
      startSec: parseTimecode(match[1], options),
      endSec: parseTimecode(match[2], options),
      text,
    });
  }

  return segments;
}

function parseTimestampLines(input: string, options: ParseScriptOptions): ScriptSegment[] {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const segments: ScriptSegment[] = [];

  for (const line of lines) {
    const rangeMatch = line.match(RANGE_RE);
    if (rangeMatch) {
      const text = line.replace(rangeMatch[0], "").trim();
      if (!text) {
        continue;
      }

      segments.push({
        id: `segment-${segments.length + 1}`,
        startSec: parseTimecode(rangeMatch[1], options),
        endSec: parseTimecode(rangeMatch[2], options),
        text,
      });
      continue;
    }

    const singleMatch = line.match(SINGLE_TIMESTAMP_RE);
    if (!singleMatch) {
      continue;
    }

    segments.push({
      id: `segment-${segments.length + 1}`,
      startSec: parseTimecode(singleMatch[1], options),
      endSec: null,
      text: singleMatch[2].trim(),
    });
  }

  return segments;
}

function normalizeSegments(segments: ScriptSegment[]): ScriptSegment[] {
  const sorted = [...segments].sort((left, right) => left.startSec - right.startSec);

  return sorted.map((segment, index) => {
    const nextSegment = sorted[index + 1];
    const normalizedEnd =
      segment.endSec && segment.endSec > segment.startSec
        ? segment.endSec
        : nextSegment && nextSegment.startSec > segment.startSec
          ? nextSegment.startSec
          : null;

    return {
      ...segment,
      id: `segment-${index + 1}`,
      endSec: normalizedEnd,
    };
  });
}

function parseTimecode(rawValue: string, options: ParseScriptOptions): number {
  const value = rawValue.trim();
  const parts = value.split(":");

  if (parts.length < 2 || parts.length > 4) {
    throw new Error(`Invalid timecode: ${rawValue}`);
  }

  if (parts.length === 4) {
    return parseFrameTimecode(parts, rawValue, options);
  }

  const [hoursPart, minutesPart, secondsPart] =
    parts.length === 3 ? parts : ["0", parts[0], parts[1]];
  const hours = parseNumber(hoursPart, "hours", rawValue);
  const minutes = parseNumber(minutesPart, "minutes", rawValue);
  const seconds = parseNumber(secondsPart.replace(",", "."), "seconds", rawValue);

  validateClockParts(hours, minutes, seconds, rawValue);
  return hours * 3600 + minutes * 60 + seconds;
}

function parseFrameTimecode(
  parts: string[],
  rawValue: string,
  options: ParseScriptOptions,
): number {
  const fps = options.fps ?? 30;
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`Invalid FPS for frame timecode parsing: ${fps}`);
  }

  const hours = parseNumber(parts[0], "hours", rawValue);
  const minutes = parseNumber(parts[1], "minutes", rawValue);
  const seconds = parseNumber(parts[2], "seconds", rawValue);
  const frames = parseNumber(parts[3], "frames", rawValue);

  validateClockParts(hours, minutes, seconds, rawValue);

  if (!Number.isInteger(frames) || frames < 0 || frames >= Math.ceil(fps)) {
    throw new Error(
      `Invalid frame count in timecode ${rawValue}. Expected 0-${Math.ceil(fps) - 1} for ${fps.toFixed(2)} fps.`,
    );
  }

  return hours * 3600 + minutes * 60 + seconds + frames / fps;
}

function parseNumber(value: string, label: string, rawValue: string): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label} in timecode: ${rawValue}`);
  }

  return parsed;
}

function validateClockParts(hours: number, minutes: number, seconds: number, rawValue: string): void {
  if (!Number.isInteger(hours) || hours < 0) {
    throw new Error(`Invalid hours in timecode: ${rawValue}`);
  }

  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 60) {
    throw new Error(`Invalid minutes in timecode: ${rawValue}`);
  }

  if (seconds < 0 || seconds >= 60) {
    throw new Error(`Invalid seconds in timecode: ${rawValue}`);
  }
}
