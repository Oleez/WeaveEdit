import {
  executeTimelineJob,
  isCepEnvironment,
  isNodeEnabled,
  saveBase64Image,
} from "@/lib/cep";
import { AgentDeliberation } from "@/lib/edit-core/types";
import type { ImageQuality } from "@/lib/edit-core/project-settings-store";
import { AgentContext } from "../agents/shared";
import { engineerImagePrompt } from "../agents/prompt-engineer";
import { generateImage } from "./openai-images";

export interface GenerateAndPlaceInput {
  /** Script line / idea used both for prompt engineering and the placement label. */
  idea: string;
  atSec: number;
  editorialRole?: string;
  styleNotes?: string;
  apiKey: string;
  model: string;
  quality: ImageQuality;
  imageFolder: string;
  /** 0-based main video track the editor targets. */
  targetVideoTrackIndex: number;
  /** Tracks above the main track to place the image on (1 = one up). */
  trackOffset: number;
  durationSec: number;
  agentContext?: AgentContext;
  /** When provided (e.g. batch flow), skip the prompt-engineer agent and use this prompt. */
  promptOverride?: string;
  negativeOverride?: string;
}

export interface GenerateAndPlaceResult {
  ok: boolean;
  filePath?: string;
  prompt: string;
  message: string;
  deliberation: AgentDeliberation[];
}

/**
 * Full single-image pipeline: engineer a prompt (unless overridden) -> generate with
 * gpt-image-1 -> save to disk -> import & place on the overlay track at `atSec`.
 */
export async function generateAndPlaceImage(
  input: GenerateAndPlaceInput,
): Promise<GenerateAndPlaceResult> {
  if (!isCepEnvironment() || !isNodeEnabled()) {
    return {
      ok: false,
      prompt: "",
      message: "Image generation only runs inside the Premiere (Node-enabled) panel.",
      deliberation: [],
    };
  }
  if (!input.apiKey) {
    return {
      ok: false,
      prompt: "",
      message: "Set your OpenAI API key in Settings to generate images.",
      deliberation: [],
    };
  }

  let prompt = input.promptOverride?.trim() ?? "";
  let negativePrompt = input.negativeOverride?.trim() ?? "";
  let size = "1536x1024";
  const deliberation: AgentDeliberation[] = [];

  if (!prompt) {
    const engineered = await engineerImagePrompt(
      { idea: input.idea, editorialRole: input.editorialRole, styleNotes: input.styleNotes },
      input.agentContext,
    );
    prompt = engineered.prompt;
    negativePrompt = engineered.negativePrompt;
    size = engineered.size;
    deliberation.push({
      agent: "prompt-engineer",
      claim: engineered.claim,
      evidence: [prompt],
      confidence: engineered.confidence,
    });
  }

  // gpt-image-1 has no separate negative-prompt parameter, so fold it into the prompt.
  const fullPrompt = negativePrompt ? `${prompt}\n\nAvoid: ${negativePrompt}` : prompt;

  let b64: string;
  try {
    const generated = await generateImage({
      apiKey: input.apiKey,
      model: input.model,
      prompt: fullPrompt,
      quality: input.quality,
      size,
    });
    b64 = generated.b64;
  } catch (error) {
    return {
      ok: false,
      prompt,
      message: `Image generation failed: ${error instanceof Error ? error.message : String(error)}`,
      deliberation,
    };
  }

  let filePath: string;
  try {
    const fileName = `weave-gen-${Date.now()}-${Math.floor(Math.random() * 9999)}.png`;
    filePath = saveBase64Image(input.imageFolder, fileName, b64);
  } catch (error) {
    return {
      ok: false,
      prompt,
      message: `Could not save the generated image: ${error instanceof Error ? error.message : String(error)}`,
      deliberation,
    };
  }

  const trackOffset = Math.max(0, Math.round(input.trackOffset));
  const durationSec = Math.max(0.5, input.durationSec);
  try {
    const run = await executeTimelineJob({
      targetVideoTrackIndex: input.targetVideoTrackIndex,
      appendAtTrackEnd: false,
      useSequenceInOut: false,
      rangeStartSec: null,
      rangeEndSec: null,
      placements: [
        {
          id: `gen-${Date.now()}`,
          trackOffset,
          startSec: input.atSec,
          endSec: input.atSec + durationSec,
          durationSec,
          sourceInSec: 0,
          sourceOutSec: durationSec,
          mediaPath: filePath,
          strategy: "generated",
          text: input.idea.slice(0, 80),
        },
      ],
    });

    const placedTrack = input.targetVideoTrackIndex + trackOffset + 1;
    return {
      ok: run.ok && run.placedCount > 0,
      filePath,
      prompt,
      message:
        run.placedCount > 0
          ? `Generated image placed on V${placedTrack} at ${input.atSec.toFixed(1)}s.`
          : `Image saved to ${filePath}, but placement reported: ${run.message}`,
      deliberation,
    };
  } catch (error) {
    return {
      ok: false,
      filePath,
      prompt,
      message: `Image saved to ${filePath}, but placement failed: ${error instanceof Error ? error.message : String(error)}`,
      deliberation,
    };
  }
}
