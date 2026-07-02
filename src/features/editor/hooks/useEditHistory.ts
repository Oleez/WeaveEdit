import { useEffect, useRef, useState } from "react";
import {
  EditHistoryEntry,
  EditHistorySnapshot,
  createHistoryEntry,
  loadProjectHistory,
  pushHistoryEntry,
  restoreHistoryTo,
  saveProjectHistory,
  undoHistory,
} from "@/lib/edit-core/edit-history";

export interface UseEditHistoryOptions {
  projectId: string | null;
  /** Applies a checkpoint (or the session baseline) back onto panel state. */
  onRestore: (snapshot: EditHistorySnapshot) => void;
}

/**
 * Edit-history stack with "undo till then". Checkpoints capture the preview
 * plan + script text after every meaningful action; restoring puts them back.
 * The last 20 entries per project survive panel reloads.
 */
export function useEditHistory({ projectId, onRestore }: UseEditHistoryOptions) {
  const [entries, setEntries] = useState<EditHistoryEntry[]>([]);
  const baselineRef = useRef<EditHistorySnapshot>({ plan: null, scriptText: "" });
  const hydratedProjectRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (hydratedProjectRef.current === projectId) {
      return;
    }
    hydratedProjectRef.current = projectId;
    setEntries(loadProjectHistory(projectId));
  }, [projectId]);

  useEffect(() => {
    if (hydratedProjectRef.current !== projectId) {
      return;
    }
    saveProjectHistory(projectId, entries);
  }, [entries, projectId]);

  /** Records what the panel looks like before any history entry exists, so a full undo has somewhere to land. */
  function setBaseline(snapshot: EditHistorySnapshot): void {
    baselineRef.current = snapshot;
  }

  function push(
    label: string,
    snapshot: EditHistorySnapshot,
    appliedToPremiere = false,
    baselineIfFirst?: EditHistorySnapshot,
  ): void {
    setEntries((prev) => {
      if (prev.length === 0 && baselineIfFirst) {
        baselineRef.current = baselineIfFirst;
      }
      return pushHistoryEntry(prev, createHistoryEntry(label, snapshot, appliedToPremiere));
    });
  }

  function undo(): void {
    setEntries((prev) => {
      const result = undoHistory(prev);
      if (!result.changed) {
        return prev;
      }
      onRestore(result.restore ?? baselineRef.current);
      return result.entries;
    });
  }

  function restoreTo(id: string): void {
    setEntries((prev) => {
      const result = restoreHistoryTo(prev, id);
      if (!result.restore) {
        return prev;
      }
      onRestore(result.restore);
      return result.entries;
    });
  }

  return {
    entries,
    canUndo: entries.length > 0,
    push,
    undo,
    restoreTo,
    setBaseline,
  };
}
