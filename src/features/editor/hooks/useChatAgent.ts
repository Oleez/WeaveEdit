import { useState } from "react";
import { routeChatToPlan } from "@/lib/ai/agents/chat-router";
import { EditPlan } from "@/lib/edit-core/types";

export function useChatAgent() {
  const [chatValue, setChatValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function previewChatEdit(plan: EditPlan): Promise<EditPlan | null> {
    const trimmed = chatValue.trim();
    if (!trimmed) {
      return null;
    }
    setBusy(true);
    try {
      const next = await routeChatToPlan(plan, trimmed);
      setChatValue("");
      return next;
    } finally {
      setBusy(false);
    }
  }

  return { chatValue, setChatValue, busy, previewChatEdit };
}
