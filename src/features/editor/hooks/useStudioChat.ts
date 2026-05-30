import { useState } from "react";
import { AgentContext } from "@/lib/ai/agents/shared";
import { AgentDeliberation } from "@/lib/edit-core/types";
import { StudioChatContext, ToolRegistry, runStudioChat } from "@/lib/ai/studio-chat";
import { ChatMessageView } from "../chat-types";

export interface StudioChatSendDeps {
  agentContext?: AgentContext;
  registry: ToolRegistry;
  context: StudioChatContext;
}

let messageCounter = 0;
function nextId(prefix: string): string {
  messageCounter += 1;
  return `${prefix}-${Date.now()}-${messageCounter}`;
}

/**
 * Multi-turn agent chat state. Owns the conversation history and busy flag; the caller passes
 * the tool registry + context at send time (it owns the plan/script/host state the tools act on).
 */
export function useStudioChat() {
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [deliberation, setDeliberation] = useState<AgentDeliberation[]>([]);

  async function send(text: string, deps: StudioChatSendDeps): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || busy) {
      return;
    }

    const history = messages.map((message) => ({ role: message.role, content: message.content }));
    setMessages((prev) => [...prev, { id: nextId("u"), role: "user", content: trimmed }]);
    setInput("");
    setBusy(true);

    try {
      const result = await runStudioChat({
        history,
        userMessage: trimmed,
        agentContext: deps.agentContext,
        registry: deps.registry,
        context: deps.context,
      });
      setMessages((prev) => [
        ...prev,
        { id: nextId("a"), role: "assistant", content: result.reply, activity: result.activity },
      ]);
      setDeliberation(result.deliberation);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId("a"),
          role: "assistant",
          content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function reset(): void {
    setMessages([]);
    setDeliberation([]);
    setInput("");
  }

  return { messages, input, setInput, busy, deliberation, send, reset };
}
