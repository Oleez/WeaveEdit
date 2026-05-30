import { describe, expect, it } from "vitest";
import { engineerImagePrompt } from "../../src/lib/ai/agents/prompt-engineer";

describe("engineerImagePrompt fallback", () => {
  it("produces a usable heuristic prompt when AI is off", async () => {
    const result = await engineerImagePrompt({
      idea: "a founder reviewing a revenue dashboard on a laptop",
      editorialRole: "hook",
    });

    expect(result.prompt).toContain("a founder reviewing a revenue dashboard on a laptop");
    expect(result.size).toBe("1536x1024");
    expect(result.negativePrompt.length).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(0.5);
  });

  it("respects a disabled agent context the same as no context", async () => {
    const result = await engineerImagePrompt(
      { idea: "calm ocean at sunrise" },
      { enabled: false, ollamaBaseUrl: "http://127.0.0.1:11434", ollamaModel: "gemma4:e4b" },
    );

    expect(result.prompt).toContain("calm ocean at sunrise");
  });
});
