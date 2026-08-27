import type {
  HideMessagesPlan,
  SessionFileEntry,
  SessionTreeEntry,
} from "./types.js";
import { buildActivePath } from "./session-path.js";
import { isRecord } from "./shared/record-utils.js";

export function isSessionTreeEntry(entry: SessionFileEntry): entry is SessionTreeEntry {
  return entry.type !== "session";
}

function getMessageRole(entry: SessionTreeEntry): string | undefined {
  if (entry.type !== "message" || !isRecord(entry.message)) {
    return undefined;
  }
  return typeof entry.message.role === "string" ? entry.message.role : undefined;
}

/**
 * Whether an entry counts toward the "visible items" target.
 *
 * Tool results are excluded: they render inline with their tool call, so a
 * hidden assistant message hides its results too.
 */
function countsTowardVisibleRetainTarget(entry: SessionTreeEntry): boolean {
  if (entry.type === "message") {
    return getMessageRole(entry) !== "toolResult";
  }
  if (entry.type === "custom_message") {
    return entry.display === true;
  }
  return entry.type === "branch_summary" || entry.type === "compaction";
}

/** Index of the oldest entry to keep visible, so the newest `keepVisibleCount` items remain. */
function determineCutoffIndex(path: readonly SessionTreeEntry[], keepVisibleCount: number): number {
  if (path.length === 0) {
    return 0;
  }

  let retained = 0;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (!countsTowardVisibleRetainTarget(path[index])) {
      continue;
    }
    retained += 1;
    if (retained >= keepVisibleCount) {
      return index;
    }
  }
  return 0;
}

function setHiddenState(entry: SessionTreeEntry, hidden: boolean): SessionTreeEntry {
  const currentlyHidden = entry.hidden === true;
  if (currentlyHidden === hidden) {
    return entry;
  }
  if (hidden) {
    return { ...entry, hidden: true };
  }
  const { hidden: _hidden, ...rest } = entry;
  return rest;
}

function updateEntriesForHiddenPrefix(
  entries: readonly SessionFileEntry[],
  path: readonly SessionTreeEntry[],
  cutoffIndex: number,
): HideMessagesPlan {
  const hiddenIds = new Set(path.slice(0, cutoffIndex).map((entry) => entry.id));
  const visibleIds = new Set(path.slice(cutoffIndex).map((entry) => entry.id));
  const visibleItemCount = path.filter(countsTowardVisibleRetainTarget).length;
  const retainedVisibleItemCount = path.slice(cutoffIndex).filter(countsTowardVisibleRetainTarget).length;

  let changed = false;
  const nextEntries = entries.map((entry) => {
    if (!isSessionTreeEntry(entry)) {
      return entry;
    }
    if (hiddenIds.has(entry.id)) {
      const nextEntry = setHiddenState(entry, true);
      changed ||= nextEntry !== entry;
      return nextEntry;
    }
    if (visibleIds.has(entry.id)) {
      const nextEntry = setHiddenState(entry, false);
      changed ||= nextEntry !== entry;
      return nextEntry;
    }
    return entry;
  });

  return {
    entries: nextEntries,
    changed,
    hiddenEntryCount: hiddenIds.size,
    visibleItemCount,
    retainedVisibleItemCount,
    firstVisibleEntryId: path[cutoffIndex]?.id,
  };
}

/**
 * Mark the oldest entries on the active branch as hidden so only the newest
 * `keepVisibleCount` chat items stay visible. Entries outside the active path
 * are left untouched. Returns a plan with the updated entry list.
 */
export function applyHiddenPrefix(
  entries: readonly SessionFileEntry[],
  keepVisibleCount: number,
  leafId?: string | null,
): HideMessagesPlan {
  if (!Number.isInteger(keepVisibleCount) || keepVisibleCount < 1) {
    throw new Error("Visible count must be a positive integer.");
  }

  const treeEntries = entries.filter(isSessionTreeEntry);
  const path = buildActivePath(treeEntries, leafId);
  if (path.length === 0) {
    return {
      entries: [...entries],
      changed: false,
      hiddenEntryCount: 0,
      visibleItemCount: 0,
      retainedVisibleItemCount: 0,
    };
  }

  const cutoffIndex = determineCutoffIndex(path, keepVisibleCount);
  return updateEntriesForHiddenPrefix(entries, path, cutoffIndex);
}

export function hasHiddenEntries(entries: readonly SessionTreeEntry[]): boolean {
  return entries.some((entry) => entry.hidden === true);
}
