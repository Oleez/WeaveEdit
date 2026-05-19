import { getEnvironmentVariable, isNodeEnabled } from "@/lib/cep";

type NodeRequire = (moduleName: string) => unknown;

export interface LoudnessMeasurement {
  inputI: number | null;
  inputTp: number | null;
  inputLra: number | null;
  inputThresh: number | null;
  targetOffset: number | null;
  raw: string;
}

export function canUseFfmpegBridge(): boolean {
  return isNodeEnabled();
}

export function measureLoudness(mediaPath: string, ffmpegPath = "ffmpeg"): LoudnessMeasurement {
  const nodeRequire = window.require as NodeRequire;
  const childProcess = nodeRequire("child_process") as {
    spawnSync: (file: string, args: string[], options: { encoding: BufferEncoding }) => { stdout?: string; stderr?: string };
  };
  const result = childProcess.spawnSync(
    ffmpegPath,
    ["-hide_banner", "-nostats", "-i", mediaPath, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const raw = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const jsonMatch = /\{[\s\S]*\}/.exec(raw);
  const parsed = jsonMatch ? safeJson(jsonMatch[0]) : {};

  return {
    inputI: numberOrNull(parsed.input_i),
    inputTp: numberOrNull(parsed.input_tp),
    inputLra: numberOrNull(parsed.input_lra),
    inputThresh: numberOrNull(parsed.input_thresh),
    targetOffset: numberOrNull(parsed.target_offset),
    raw,
  };
}

export function resolvePreferredFfmpegPath(): string {
  return getEnvironmentVariable("WEAVE_EDIT_FFMPEG") || "ffmpeg";
}

function safeJson(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
