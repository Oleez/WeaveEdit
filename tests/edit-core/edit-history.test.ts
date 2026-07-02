import { beforeEach, describe, expect, it } from "vitest";
import {
  EditHistoryEntry,
  HISTORY_CAP,
  HISTORY_PERSIST_LIMIT,
  createHistoryEntry,
  loadProjectHistory,
  pushHistoryEntry,
  restoreHistoryTo,
  saveProjectHistory,
  undoHistory,
} from "../../src/lib/edit-core/edit-history";
import { EditPlan } from "../../src/lib/edit-core/types";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

Object.defineProperty(globalThis, "localStorage", {
  value: new MemoryStorage(),
  configurable: true,
});

function makePlan(id: string): EditPlan {
  return {
    id,
    createdAt: new Date().toISOString(),
    actions: [],
    rationale: [],
  };
}

function makeEntry(label: string, planId: string): EditHistoryEntry {
  return createHistoryEntry(label, { plan: makePlan(planId), scriptText: `script for ${label}` });
}

beforeEach(() => {
  localStorage.clear();
});

describe("edit history core", () => {
  it("pushes entries and caps the stack at HISTORY_CAP", () => {
    let entries: EditHistoryEntry[] = [];
    for (let index = 0; index < HISTORY_CAP + 10; index += 1) {
      entries = pushHistoryEntry(entries, makeEntry(`edit ${index}`, `plan-${index}`));
    }
    expect(entries).toHaveLength(HISTORY_CAP);
    expect(entries[0].label).toBe("edit 10");
    expect(entries[entries.length - 1].label).toBe(`edit ${HISTORY_CAP + 9}`);
  });

  it("strips diffFrom when snapshotting so history stays small", () => {
    const base = makePlan("base");
    const withDiff: EditPlan = { ...makePlan("next"), diffFrom: base };
    const entry = createHistoryEntry("chat edit", { plan: withDiff, scriptText: "s" });
    expect(entry.plan?.diffFrom).toBeUndefined();
    expect(entry.plan?.id).toBe("next");
  });

  it("undo steps back one entry and reports the snapshot to restore", () => {
    let entries: EditHistoryEntry[] = [];
    entries = pushHistoryEntry(entries, makeEntry("first", "p1"));
    entries = pushHistoryEntry(entries, makeEntry("second", "p2"));

    const result = undoHistory(entries);
    expect(result.changed).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(result.restore?.label).toBe("first");
  });

  it("undo on the last entry restores null so the caller falls back to its baseline", () => {
    const entries = pushHistoryEntry([], makeEntry("only", "p1"));
    const result = undoHistory(entries);
    expect(result.changed).toBe(true);
    expect(result.entries).toHaveLength(0);
    expect(result.restore).toBeNull();
  });

  it("undo on an empty stack is a no-op", () => {
    const result = undoHistory([]);
    expect(result.changed).toBe(false);
    expect(result.restore).toBeNull();
  });

  it("restoreTo jumps to any entry and discards everything after it", () => {
    let entries: EditHistoryEntry[] = [];
    entries = pushHistoryEntry(entries, makeEntry("first", "p1"));
    entries = pushHistoryEntry(entries, makeEntry("second", "p2"));
    entries = pushHistoryEntry(entries, makeEntry("third", "p3"));

    const result = restoreHistoryTo(entries, entries[0].id);
    expect(result.restore?.label).toBe("first");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].label).toBe("first");
  });

  it("restoreTo with an unknown id changes nothing", () => {
    const entries = pushHistoryEntry([], makeEntry("only", "p1"));
    const result = restoreHistoryTo(entries, "missing");
    expect(result.restore).toBeNull();
    expect(result.entries).toBe(entries);
  });

  it("persists the last HISTORY_PERSIST_LIMIT entries per project and round-trips", () => {
    let entries: EditHistoryEntry[] = [];
    for (let index = 0; index < HISTORY_PERSIST_LIMIT + 5; index += 1) {
      entries = pushHistoryEntry(entries, makeEntry(`edit ${index}`, `plan-${index}`));
    }
    saveProjectHistory("proj-a", entries);

    const loaded = loadProjectHistory("proj-a");
    expect(loaded).toHaveLength(HISTORY_PERSIST_LIMIT);
    expect(loaded[loaded.length - 1].label).toBe(`edit ${HISTORY_PERSIST_LIMIT + 4}`);
    expect(loaded[0].label).toBe("edit 5");
    expect(loaded[0].scriptText).toBe("script for edit 5");
  });

  it("keeps histories isolated per project and tolerates null project ids", () => {
    saveProjectHistory("proj-a", [makeEntry("a-edit", "p1")]);
    saveProjectHistory("proj-b", [makeEntry("b-edit", "p2")]);
    saveProjectHistory(null, [makeEntry("nowhere", "p3")]);

    expect(loadProjectHistory("proj-a")[0].label).toBe("a-edit");
    expect(loadProjectHistory("proj-b")[0].label).toBe("b-edit");
    expect(loadProjectHistory(null)).toEqual([]);
  });
});
