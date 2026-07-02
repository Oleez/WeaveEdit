import { EditPlan } from "./types";
import { createPlanId } from "./plan-builder";

/**
 * Pure edit-history core: a stack of checkpoints taken after every meaningful
 * panel action (Autopilot, chat edit, script edit, Apply). The React hook wraps
 * these functions; keeping them pure makes undo/restore fully testable.
 */

export interface EditHistorySnapshot {
  /** Preview plan at this checkpoint (diffFrom stripped to keep snapshots small). */
  plan: EditPlan | null;
  scriptText: string;
}

export interface EditHistoryEntry extends EditHistorySnapshot {
  id: string;
  label: string;
  timestamp: string;
  appliedToPremiere: boolean;
}

export const HISTORY_CAP = 50;
export const HISTORY_PERSIST_LIMIT = 20;
export const HISTORY_STORAGE_PREFIX = "weave-edit-history:";

export function createHistoryEntry(
  label: string,
  snapshot: EditHistorySnapshot,
  appliedToPremiere = false,
): EditHistoryEntry {
  return {
    id: createPlanId("hist"),
    label,
    timestamp: new Date().toISOString(),
    plan: snapshot.plan ? { ...snapshot.plan, diffFrom: undefined } : null,
    scriptText: snapshot.scriptText,
    appliedToPremiere,
  };
}

/** Appends an entry, dropping the oldest ones past the cap. */
export function pushHistoryEntry(entries: EditHistoryEntry[], entry: EditHistoryEntry): EditHistoryEntry[] {
  const next = [...entries, entry];
  return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
}

/**
 * Steps back one checkpoint. Returns the remaining stack and the snapshot to
 * restore (the new newest entry), or `restore: null` when the stack empties —
 * the caller then restores its session baseline.
 */
export function undoHistory(entries: EditHistoryEntry[]): {
  entries: EditHistoryEntry[];
  restore: EditHistoryEntry | null;
  changed: boolean;
} {
  if (entries.length === 0) {
    return { entries, restore: null, changed: false };
  }
  const next = entries.slice(0, -1);
  return { entries: next, restore: next[next.length - 1] ?? null, changed: true };
}

/**
 * "Undo till then": jumps to any checkpoint by id, discarding everything after
 * it. Returns the entry to restore, or null if the id is unknown.
 */
export function restoreHistoryTo(entries: EditHistoryEntry[], id: string): {
  entries: EditHistoryEntry[];
  restore: EditHistoryEntry | null;
} {
  const index = entries.findIndex((entry) => entry.id === id);
  if (index === -1) {
    return { entries, restore: null };
  }
  return { entries: entries.slice(0, index + 1), restore: entries[index] };
}

export function historyStorageKey(projectId: string): string {
  return `${HISTORY_STORAGE_PREFIX}${projectId}`;
}

export function loadProjectHistory(projectId: string | null): EditHistoryEntry[] {
  if (!projectId) {
    return [];
  }
  try {
    const raw = getStorage()?.getItem(historyStorageKey(projectId));
    const parsed = raw ? (JSON.parse(raw) as EditHistoryEntry[]) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveProjectHistory(projectId: string | null, entries: EditHistoryEntry[]): void {
  if (!projectId) {
    return;
  }
  const trimmed = entries.slice(Math.max(0, entries.length - HISTORY_PERSIST_LIMIT));
  try {
    getStorage()?.setItem(historyStorageKey(projectId), JSON.stringify(trimmed));
  } catch {
    // Quota or serialization failure — history persistence is best-effort.
  }
}

function getStorage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}
