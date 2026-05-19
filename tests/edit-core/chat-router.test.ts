import { describe, expect, it } from "vitest";
import { parseChatIntent } from "../../src/lib/ai/agents/chat-router";

describe("parseChatIntent", () => {
  it("maps natural edit language to structured preview ops", () => {
    const intent = parseChatIntent("tighten silence to 200ms and punch in on every claim, then polish audio");
    expect(intent.ops.map((op) => op.kind)).toEqual(expect.arrayContaining(["tighten", "punch_in", "audio_polish"]));
  });
});
