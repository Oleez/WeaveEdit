import { describe, expect, it } from "vitest";
import { parseTimestampScript } from "../src/lib/script-parser";
import { applyScriptEdit, findSegmentAtTime, serializeSegmentsToScript } from "../src/lib/script-edit";

const SAMPLE = [
  "00:00:00 First line here.",
  "00:00:05 Second line here.",
  "00:00:10 Third line here.",
].join("\n");

describe("findSegmentAtTime", () => {
  it("returns the segment containing the playhead", () => {
    const { segments } = parseTimestampScript(SAMPLE, { fps: 30 });
    expect(findSegmentAtTime(segments, 6)?.text).toBe("Second line here.");
    expect(findSegmentAtTime(segments, 0)?.text).toBe("First line here.");
  });

  it("falls back to the nearest segment when the playhead is past the end", () => {
    const { segments } = parseTimestampScript(SAMPLE, { fps: 30 });
    expect(findSegmentAtTime(segments, 999)?.text).toBe("Third line here.");
  });

  it("returns null for an empty segment list", () => {
    expect(findSegmentAtTime([], 5)).toBeNull();
  });
});

describe("serializeSegmentsToScript", () => {
  it("round-trips through the parser preserving timing and text", () => {
    const { segments } = parseTimestampScript(SAMPLE, { fps: 30 });
    const reparsed = parseTimestampScript(serializeSegmentsToScript(segments), { fps: 30 }).segments;

    expect(reparsed).toHaveLength(segments.length);
    reparsed.forEach((segment, index) => {
      expect(segment.text).toBe(segments[index].text);
      expect(segment.startSec).toBeCloseTo(segments[index].startSec, 3);
    });
  });
});

describe("applyScriptEdit", () => {
  it("replaces the text of the line at the playhead", () => {
    const result = applyScriptEdit(SAMPLE, { atSec: 6, newText: "Replaced second." }, { fps: 30 });
    expect(result.changedSegmentId).not.toBeNull();
    expect(result.previousText).toBe("Second line here.");

    const reparsed = parseTimestampScript(result.scriptText, { fps: 30 }).segments;
    expect(findSegmentAtTime(reparsed, 6)?.text).toBe("Replaced second.");
    // Other lines are untouched.
    expect(findSegmentAtTime(reparsed, 0)?.text).toBe("First line here.");
  });

  it("replaces the whole document for scope 'all'", () => {
    const result = applyScriptEdit(SAMPLE, { atSec: 0, newText: "00:00:00 only line", scope: "all" }, { fps: 30 });
    expect(result.scriptText).toBe("00:00:00 only line");
    expect(result.changedSegmentId).toBeNull();
  });
});
