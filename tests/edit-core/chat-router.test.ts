import { describe, expect, it } from "vitest";
import { parseChatIntent, parseChatIntentWithLlm, routeChatToPlan } from "../../src/lib/ai/agents/chat-router";
import { replanFromIntent } from "../../src/lib/edit-core/autopilot";
import { ChatEditIntent, EditPlan } from "../../src/lib/edit-core/types";
import { TimelinePlacement } from "../../src/lib/timeline-plan";

function makePlacement(overrides: Partial<TimelinePlacement>): TimelinePlacement {
  return {
    id: "p1",
    groupId: "g1",
    segmentId: "s1",
    layerIndex: 0,
    trackOffset: 0,
    startSec: 0,
    endSec: 4,
    durationSec: 4,
    strategy: "ai",
    mediaPath: "C:/media/a.mp4",
    mediaName: "a.mp4",
    mediaType: "video",
    text: "hello world this is a line",
    keywordScore: 1,
    aiConfidence: 0.9,
    aiRationale: null,
    aiVisualMatchReason: null,
    matchKind: null,
    mediaPreference: null,
    aiProvider: null,
    lowConfidence: false,
    fallbackReason: null,
    timingSource: "segment",
    timingRationale: null,
    overlapStyle: "single",
    editorialRole: "hook",
    sourceInSec: null,
    sourceOutSec: null,
    sourceDurationSec: null,
    trimApplied: false,
    trimNote: null,
    ...overrides,
  };
}

function makeRichPlan(): EditPlan {
  const p1 = makePlacement({ id: "p1", segmentId: "s1", mediaPath: "C:/media/a.mp4", mediaName: "a.mp4" });
  const p2 = makePlacement({
    id: "p2",
    segmentId: "s2",
    startSec: 4,
    endSec: 8,
    mediaPath: "C:/media/b.mp4",
    mediaName: "b.mp4",
    aiConfidence: 0.3,
    lowConfidence: true,
  });
  return {
    id: "base",
    createdAt: new Date().toISOString(),
    actions: [
      { kind: "place_clip", placementId: "p1", track: "V1", startSec: 0, endSec: 4, mediaPath: p1.mediaPath, placement: p1 },
      { kind: "place_clip", placementId: "p2", track: "V1", startSec: 4, endSec: 8, mediaPath: p2.mediaPath, placement: p2 },
      {
        kind: "cut_silence",
        audioTrackIndex: 0,
        spans: [
          { id: "sp1", trackIndex: 0, sourcePath: "C:/media/vo.wav", clipName: "vo", startSec: 1, endSec: 1.5, durationSec: 0.5 },
          { id: "sp2", trackIndex: 0, sourcePath: "C:/media/vo.wav", clipName: "vo", startSec: 5, endSec: 5.1, durationSec: 0.1 },
        ],
      },
    ],
    rationale: [],
  };
}

function intentOf(kind: ChatEditIntent["ops"][number]["kind"], value?: number): ChatEditIntent {
  return { rawText: `test ${kind}`, ops: [{ kind, value }] };
}

describe("parseChatIntent", () => {
  it("maps natural edit language to structured preview ops", () => {
    const intent = parseChatIntent("tighten silence to 200ms and punch in on every claim, then polish audio");
    expect(intent.ops.map((op) => op.kind)).toEqual(expect.arrayContaining(["tighten", "punch_in", "audio_polish"]));
  });

  it("defaults to replace_broll when nothing else matches", () => {
    const intent = parseChatIntent("rethink the visuals please");
    expect(intent.ops[0].kind).toBe("replace_broll");
  });
});

describe("parseChatIntentWithLlm (fallback path)", () => {
  it("falls back to regex parsing when agent context is missing", async () => {
    const intent = await parseChatIntentWithLlm("add transitions between every clip");
    expect(intent.ops.some((op) => op.kind === "transitions")).toBe(true);
  });

  it("falls back to regex when ollama is disabled", async () => {
    const intent = await parseChatIntentWithLlm("polish audio", {
      enabled: false,
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "gemma4:e4b",
    });
    expect(intent.ops.some((op) => op.kind === "audio_polish")).toBe(true);
  });
});

describe("routeChatToPlan", () => {
  it("emits an EditPlan with chat-router rationale appended", async () => {
    const plan: EditPlan = {
      id: "base",
      createdAt: new Date().toISOString(),
      actions: [
        { kind: "place_clip", placementId: "p1", track: "V1", startSec: 0, endSec: 4, mediaPath: "a.mp4" },
        { kind: "place_clip", placementId: "p2", track: "V1", startSec: 4, endSec: 8, mediaPath: "b.mp4" },
      ],
      rationale: [],
    };
    const next = await routeChatToPlan(plan, "punch in on every claim");
    expect(next.diffFrom).toBe(plan);
    expect(next.rationale.some((entry) => entry.agent === "chat-router")).toBe(true);
    expect(next.actions.length).toBeGreaterThanOrEqual(plan.actions.length);
  });
});

describe("replanFromIntent — every intent yields actions or explanatory rationale (no silent no-ops)", () => {
  const ALL_INTENTS: Array<ChatEditIntent["ops"][number]["kind"]> = [
    "tighten",
    "punch_in",
    "captions",
    "audio_polish",
    "transitions",
    "color_match",
    "replace_broll",
  ];

  for (const kind of ALL_INTENTS) {
    it(`${kind} produces new actions or a chat-router rationale entry`, () => {
      const plan = makeRichPlan();
      const next = replanFromIntent(plan, intentOf(kind));
      const newActions = next.actions.length - plan.actions.length;
      const newRationale = next.rationale.filter((entry) => entry.agent === "chat-router");
      expect(newActions > 0 || newRationale.length > 0).toBe(true);
      // Every intent must explain itself beyond the generic summary line.
      expect(newRationale.length).toBeGreaterThanOrEqual(2);
    });
  }

  it("tighten re-cuts only silence gaps at or above the requested minimum", () => {
    const next = replanFromIntent(makeRichPlan(), intentOf("tighten", 0.2));
    const cutActions = next.actions.filter((action) => action.kind === "cut_silence");
    // Base plan has one cut_silence; tighten appends a second with the 0.5s gap only.
    expect(cutActions).toHaveLength(2);
    const tightened = cutActions[1];
    expect(tightened.kind === "cut_silence" && tightened.spans).toHaveLength(1);
    expect(tightened.kind === "cut_silence" && tightened.spans[0].durationSec).toBe(0.5);
  });

  it("tighten without silence data explains instead of silently doing nothing", () => {
    const plan = makeRichPlan();
    plan.actions = plan.actions.filter((action) => action.kind !== "cut_silence");
    const next = replanFromIntent(plan, intentOf("tighten"));
    expect(next.actions).toHaveLength(plan.actions.length);
    expect(next.rationale.some((entry) => entry.claim.includes("nothing to tighten"))).toBe(true);
  });

  it("captions builds a word-timed caption run from placement text", () => {
    const next = replanFromIntent(makeRichPlan(), intentOf("captions"));
    const captionRuns = next.actions.filter((action) => action.kind === "add_caption_run");
    expect(captionRuns).toHaveLength(1);
    expect(captionRuns[0].kind === "add_caption_run" && captionRuns[0].words.length).toBeGreaterThan(0);
  });

  it("color_match targets every clip after the reference clip", () => {
    const next = replanFromIntent(makeRichPlan(), intentOf("color_match"));
    const matches = next.actions.filter((action) => action.kind === "color_match");
    expect(matches).toHaveLength(1);
    expect(matches[0].kind === "color_match" && matches[0].referencePath).toBe("C:/media/a.mp4");
    expect(matches[0].kind === "color_match" && matches[0].placementId).toBe("p2");
  });

  it("replace_broll swaps weak clips using the next-best AI-ranked asset", () => {
    const next = replanFromIntent(makeRichPlan(), intentOf("replace_broll"), {
      rankingsBySegmentId: {
        s2: {
          provider: "ollama",
          segmentId: "s2",
          confidence: 0.8,
          rationale: "ranked",
          fallbackUsed: false,
          rankedAssets: [
            { candidateId: "C:/media/b.mp4", score: 0.3, rationale: "current pick" },
            { candidateId: "C:/media/c.mp4", score: 0.75, rationale: "stronger literal match" },
          ],
        },
      },
      mediaItems: [
        { path: "C:/media/c.mp4", name: "c.mp4", type: "video", extension: ".mp4" },
      ],
    });
    const replacements = next.actions.slice(makeRichPlan().actions.length);
    const swapped = replacements.find((action) => action.kind === "place_clip");
    expect(swapped?.kind === "place_clip" && swapped.mediaPath).toBe("C:/media/c.mp4");
    expect(swapped?.kind === "place_clip" && swapped.placementId).toBe("p2");
  });

  it("replace_broll without rankings tells the user to run Analyze with AI first", () => {
    const next = replanFromIntent(makeRichPlan(), intentOf("replace_broll"));
    const newActions = next.actions.length - makeRichPlan().actions.length;
    expect(newActions).toBe(0);
    expect(next.rationale.some((entry) => entry.claim.includes("Analyze with AI"))).toBe(true);
  });
});
