import { SilenceSpan } from "@/lib/cep";
import { TimelinePlacement } from "@/lib/timeline-plan";

export type TrackKind = "video" | "audio" | "caption";
export type TransitionStyle = "cut" | "cross_dissolve" | "dip_to_black" | "push" | "whip";
export type ExportPreset = "match_source" | "social_1080p" | "shorts_1080x1920" | "podcast_audio";

export interface AudioKeyframe {
  timeSec: number;
  db: number;
}

export interface CaptionWord {
  word: string;
  startSec: number;
  endSec: number;
}

export interface CaptionStyle {
  preset: "clean-bold" | "hormozi-punchy" | "minimal-premium" | "documentary-lower-third" | "ugc-native";
  font?: string;
  color?: string;
  position?: "lower" | "middle" | "top";
}

export interface SpeedRampPoint {
  timeSec: number;
  speedPct: number;
}

export type EditAction =
  | {
      kind: "place_clip";
      placementId: string;
      track: string;
      startSec: number;
      endSec: number;
      mediaPath: string | null;
      placement?: TimelinePlacement;
    }
  | { kind: "trim_clip"; placementId: string; newStartSec: number; newEndSec: number }
  | { kind: "cut_silence"; spans: SilenceSpan[]; audioTrackIndex: number }
  | { kind: "set_audio_level"; trackIndex: number; dbKeyframes: AudioKeyframe[] }
  | { kind: "duck_under_voice"; musicTrackIndex: number; voiceTrackIndex: number; duckDb: number }
  | { kind: "normalize_loudness"; trackIndex: number; targetLufs: number }
  | { kind: "add_transition"; placementId: string; style: TransitionStyle; durationSec: number }
  | { kind: "add_caption_run"; words: CaptionWord[]; style: CaptionStyle; track: string }
  | { kind: "speed_ramp"; placementId: string; curve: SpeedRampPoint[] }
  | { kind: "punch_in"; placementId: string; scalePct: number; durationSec: number }
  | { kind: "color_match"; placementId: string; referencePath: string }
  | { kind: "reorder_segments"; order: string[] }
  | { kind: "export"; preset: ExportPreset };

export interface AgentDeliberation {
  agent:
    | "director"
    | "pacing"
    | "continuity"
    | "audio"
    | "critic"
    | "chat-router"
    | "executor"
    | "script-editor"
    | "prompt-engineer"
    | "orchestrator";
  claim: string;
  evidence: string[];
  confidence: number;
}

export interface EditPlan {
  id: string;
  createdAt: string;
  basedOnPlanId?: string;
  actions: EditAction[];
  rationale: AgentDeliberation[];
  diffFrom?: EditPlan;
}

export interface EditPlanDiff {
  added: EditAction[];
  changed: Array<{ before: EditAction; after: EditAction }>;
  removed: EditAction[];
}

export interface ChatEditIntent {
  rawText: string;
  ops: Array<{
    kind:
      | "tighten"
      | "punch_in"
      | "captions"
      | "audio_polish"
      | "transitions"
      | "color_match"
      | "replace_broll";
    target?: string;
    value?: number | string;
  }>;
}
