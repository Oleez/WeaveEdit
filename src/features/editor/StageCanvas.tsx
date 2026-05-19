import { Pause, Play, SkipBack, SkipForward, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimelinePlacement } from "@/lib/timeline-plan";
import { formatSeconds } from "@/lib/script-parser";

interface StageCanvasProps {
  placement: TimelinePlacement | null;
  playheadSec: number;
  durationSec: number;
}

function toMediaSrc(path: string | null | undefined): string | null {
  if (!path) {
    return null;
  }
  if (/^(file|https?|data|blob):/i.test(path)) {
    return path;
  }
  const normalized = path.replace(/\\/g, "/");
  // CEP / Chromium accepts `file:///C:/...` for images on Windows; on macOS the path already starts with `/`.
  return /^[A-Za-z]:\//.test(normalized) ? `file:///${normalized}` : `file://${normalized}`;
}

export function StageCanvas({ placement, playheadSec, durationSec }: StageCanvasProps) {
  const mediaSrc = placement?.mediaType === "image" ? toMediaSrc(placement.mediaPath) : null;
  const isVideo = placement?.mediaType === "video";

  return (
    <section className="flex min-h-[360px] flex-col bg-neutral-950">
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {mediaSrc ? (
          <img
            key={mediaSrc}
            src={mediaSrc}
            alt={placement?.mediaName ?? "Stage preview"}
            className="absolute inset-0 h-full w-full object-contain"
            onError={(event) => {
              (event.currentTarget as HTMLImageElement).style.visibility = "hidden";
            }}
          />
        ) : (
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(24,24,27,1),rgba(3,7,18,1))]" />
        )}
        <div className="relative z-10 max-w-2xl px-8 text-center">
          {isVideo ? (
            <div className="mx-auto mb-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/40 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white/80">
              <Video className="h-3 w-3" />
              Video clip preview
            </div>
          ) : null}
          <p className="text-xs uppercase tracking-[0.2em] text-white/50">
            {placement?.mediaType ?? "Preview"}
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-white drop-shadow">
            {placement?.mediaName || "No placement selected"}
          </h1>
          <p className="mt-4 text-sm leading-6 text-white/70">
            {placement?.text || "Run Autopilot or select a timeline chip to preview the editorial beat."}
          </p>
        </div>
      </div>
      <div className="border-t border-white/10 bg-black/70 px-4 py-3">
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${durationSec > 0 ? Math.min(100, (playheadSec / durationSec) * 100) : 0}%` }}
          />
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-white/60">
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-white">
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-white">
              <Play className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-white">
              <Pause className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-white">
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>
          <span>
            {formatSeconds(playheadSec)} / {formatSeconds(durationSec)}
          </span>
        </div>
      </div>
    </section>
  );
}
