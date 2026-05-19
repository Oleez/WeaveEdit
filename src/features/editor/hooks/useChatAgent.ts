import { useState } from "react";
import { routeChatToPlan } from "@/lib/ai/agents/chat-router";
import { AgentContext } from "@/lib/ai/agents/shared";
import { EditPlan } from "@/lib/edit-core/types";

export function useChatAgent() {
  const [chatValue, setChatValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function previewChatEdit(
    plan: EditPlan,
    agentContext?: AgentContext,
  ): Promise<EditPlan | null> {
    const trimmed = chatValue.trim();
    if (!trimmed) {
      return null;
    }
    setBusy(true);
    try {
      const next = await routeChatToPlan(plan, trimmed, agentContext);
      setChatValue("");
      return next;
    } finally {
      setBusy(false);
    }
  }

  return { chatValue, setChatValue, busy, previewChatEdit };
}
