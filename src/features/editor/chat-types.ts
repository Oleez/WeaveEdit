export type ChatQuickAction = "edit_line" | "make_image" | "broll_section";

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Tool-activity lines attached to an assistant turn. */
  activity?: string[];
}

/** Single view-model the editor threads down to the chat panel. */
export interface ChatAgentView {
  messages: ChatMessageView[];
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  busy: boolean;
  playheadSec: number;
  deliberation: Array<{ agent: string; claim: string; confidence: number }>;
  onQuickAction: (action: ChatQuickAction) => void;
}
