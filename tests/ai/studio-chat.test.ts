import { afterEach, describe, expect, it, vi } from "vitest";
import { runStudioChat } from "../../src/lib/ai/studio-chat";

afterEach(() => {
  vi.unstubAllGlobals();
});

const baseContext = { playheadSec: 5, hasScript: true, hasPlan: false };

describe("runStudioChat fallback path", () => {
  it("degrades to apply_edit_ops with the raw message when AI is unavailable", async () => {
    const applyEditOps = vi.fn(async () => ({ ok: true, summary: "plan updated" }));

    const result = await runStudioChat({
      history: [],
      userMessage: "make it faster",
      agentContext: undefined,
      registry: { apply_edit_ops: applyEditOps },
      context: baseContext,
    });

    expect(applyEditOps).toHaveBeenCalledWith({ request: "make it faster" });
    expect(result.reply).toBe("plan updated");
    expect(result.toolCalls[0]?.tool).toBe("apply_edit_ops");
  });
});

describe("runStudioChat tool dispatch", () => {
  it("parses tool_calls from the model and invokes the registry handler", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              reply: "done",
              tool_calls: [{ tool: "edit_script", args: { instruction: "tighten" } }],
            }),
          },
        }),
      })),
    );

    const editScript = vi.fn(async () => ({ ok: true, summary: "edited line" }));

    const result = await runStudioChat({
      history: [],
      userMessage: "tighten this line",
      agentContext: { enabled: true, ollamaBaseUrl: "http://127.0.0.1:11434", ollamaModel: "gemma4:e4b" },
      registry: { edit_script: editScript },
      context: baseContext,
      maxIterations: 1,
    });

    expect(editScript).toHaveBeenCalledTimes(1);
    expect(editScript).toHaveBeenCalledWith({ instruction: "tighten" });
    expect(result.reply).toBe("done");
    expect(result.activity).toContain("edited line");
    expect(result.toolCalls[0]?.tool).toBe("edit_script");
  });

  it("ignores unknown tool names returned by the model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          message: { content: JSON.stringify({ reply: "ok", tool_calls: [{ tool: "delete_everything", args: {} }] }) },
        }),
      })),
    );

    const editScript = vi.fn(async () => ({ ok: true, summary: "edited" }));

    const result = await runStudioChat({
      history: [],
      userMessage: "do something",
      agentContext: { enabled: true, ollamaBaseUrl: "http://127.0.0.1:11434", ollamaModel: "gemma4:e4b" },
      registry: { edit_script: editScript },
      context: baseContext,
      maxIterations: 1,
    });

    expect(editScript).not.toHaveBeenCalled();
    expect(result.reply).toBe("ok");
    expect(result.toolCalls).toHaveLength(0);
  });
});
