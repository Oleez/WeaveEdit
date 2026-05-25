import { afterEach, describe, expect, it, vi } from "vitest";
import { extractShortsHeuristic, extractShortsWithAi } from "@/lib/ai/shorts-extractor";
import { serializeShortsToCsv } from "@/lib/ai/shorts-exporters";
import type { ShortExtractionSettings } from "@/lib/ai/types";
import type { ScriptSegment } from "@/lib/script-parser";

const settings: ShortExtractionSettings = {
  desiredDurationSec: 60,
  clipCount: 3,
  platform: "youtube-shorts",
  clipGoal: "retention",
  hookStyle: "value",
  allowOverrun: true,
  includeCtaEnding: true,
  avoidDuplicateTopics: true,
  minHookScore: 0.45,
  minCompletenessScore: 0.55,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shorts extractor", () => {
  it("handles an empty transcript without throwing", () => {
    const result = extractShortsHeuristic([], settings);
    expect(result.candidates).toHaveLength(0);
    expect(result.providerUsed).toBe("heuristic");
  });

  it("finds a strong candidate in a long fixture", () => {
    const result = extractShortsHeuristic(makeSegments(), settings);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].hookLine).toBeTruthy();
    expect(result.candidates[0].durationSec).toBeGreaterThanOrEqual(40);
    expect(result.candidates[0].durationSec).toBeLessThanOrEqual(90);
    expect(result.candidates[0].scores.hook).toBeGreaterThanOrEqual(0.45);
  });

  it("dedupes near-duplicate topic windows", () => {
    const duplicateSettings = { ...settings, clipCount: 10 as const, avoidDuplicateTopics: true };
    const looseSettings = { ...duplicateSettings, avoidDuplicateTopics: false };
    const duplicateSegments = [...makeSegments(), ...makeSegments(720, "dupe")];
    const deduped = extractShortsHeuristic(duplicateSegments, duplicateSettings);
    const loose = extractShortsHeuristic(duplicateSegments, looseSettings);
    expect(deduped.candidates.length).toBeLessThanOrEqual(loose.candidates.length);
  });

  it("honors strict hook thresholds", () => {
    const result = extractShortsHeuristic(makeSegments(), { ...settings, minHookScore: 0.95 });
    expect(result.candidates).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("serializes CSV with one row per candidate", () => {
    const result = extractShortsHeuristic(makeSegments(), settings);
    const csv = serializeShortsToCsv(result);
    expect(csv.trim().split("\n")).toHaveLength(result.candidates.length + 1);
    expect(csv).toContain('"id","title","hook"');
  });

  it("uses Ollama refinement when available", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        response: JSON.stringify({
          candidates: [{ id: extractShortsHeuristic(makeSegments(), settings).candidates[0].id, titleSuggestion: "AI refined title", scores: { overall: 0.99 } }],
        }),
      }),
    })));

    const result = await extractShortsWithAi(makeSegments(), settings, "local", {
      ollamaBaseUrl: "http://localhost:11434",
      ollamaModel: "gemma",
      geminiModel: "gemini",
    });

    expect(result.providerUsed).toBe("ollama");
    expect(result.candidates[0].titleSuggestion).toBe("AI refined title");
  });

  it("falls back to heuristic when both AI providers fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })));

    const result = await extractShortsWithAi(makeSegments(), settings, "hybrid", {
      ollamaBaseUrl: "http://localhost:11434",
      ollamaModel: "gemma",
      geminiModel: "gemini",
      geminiApiKey: "test",
    });

    expect(result.providerUsed).toBe("heuristic");
    expect(result.errors).toHaveLength(2);
  });
});

function makeSegments(offset = 0, prefix = "segment"): ScriptSegment[] {
  const texts = [
    "Stop trying to look confident and learn the truth about power.",
    "Most people think charisma is a gift, but it is really a repeatable system.",
    "The first rule is simple: control your reaction before you control the room.",
    "When you pause for two seconds, people feel certainty instead of panic.",
    "That tiny pause changes the whole conversation because it makes you predictable in the best way.",
    "The second rule is to name the tension out loud before anyone else can weaponize it.",
    "If the client is worried about price, say the price is the exact thing we should inspect.",
    "Now the objection becomes shared information, not a cage around the deal.",
    "The third rule is proof, because stories without proof collapse under pressure.",
    "Use one number, one example, and one consequence so the lesson has somewhere to land.",
    "This is why calm authority beats louder persuasion every single time.",
    "Follow for the next breakdown if you want the full framework.",
  ];

  return texts.map((text, index) => ({
    id: `${prefix}-${index + 1}`,
    startSec: offset + index * 6,
    endSec: offset + index * 6 + 6,
    text,
    wordCount: text.split(/\s+/).length,
    sentenceCount: 1,
    sentenceComplete: true,
    sentenceBoundaryConfidence: 1,
  }));
}
