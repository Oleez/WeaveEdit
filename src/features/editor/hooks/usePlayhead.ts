import { useEffect, useRef, useState } from "react";
import { getPlayheadPosition, isCepEnvironment } from "@/lib/cep";

interface UsePlayheadOptions {
  /** Poll interval in milliseconds. Defaults to 1000ms. */
  intervalMs?: number;
  /** Pause polling (e.g. while a long host job runs). */
  paused?: boolean;
}

/**
 * Polls Premiere's current-time-indicator (playhead) position so the agent chat always
 * knows "where the line is". Only polls inside the CEP/Premiere environment; in the
 * browser preview it stays at 0.
 */
export function usePlayhead(options: UsePlayheadOptions = {}): { playheadSec: number; refresh: () => Promise<void> } {
  const { intervalMs = 1000, paused = false } = options;
  const [playheadSec, setPlayheadSec] = useState(0);
  const inFlight = useRef(false);

  async function refresh(): Promise<void> {
    if (inFlight.current || !isCepEnvironment()) {
      return;
    }
    inFlight.current = true;
    try {
      const next = await getPlayheadPosition();
      setPlayheadSec((current) => (Math.abs(current - next) > 0.001 ? next : current));
    } catch {
      // Ignore transient host errors; keep the last known value.
    } finally {
      inFlight.current = false;
    }
  }

  useEffect(() => {
    if (paused || !isCepEnvironment()) {
      return;
    }

    void refresh();
    const handle = window.setInterval(() => {
      void refresh();
    }, Math.max(250, intervalMs));

    return () => window.clearInterval(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, paused]);

  return { playheadSec, refresh };
}
