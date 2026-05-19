import { describe, expect, it } from "vitest";
import { parseChatIntent, parseChatIntentWithLlm, routeChatToPlan } from "../../src/lib/ai/agents/chat-router";
import { EditPlan } from "../../src/lib/edit-core/types";

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
