import type { SessionFileEntry, SessionTreeEntry } from "../../src/types.js";
import {
  HIDE_MESSAGES_CONTROL_CUSTOM_TYPE,
} from "../../src/constants.js";

/**
 * Shared test fixtures for pi-hide-messages.
 *
 * Centralizes the timestamp-stamping helpers previously duplicated as
 * `withTimestamps` (session-control.test.ts) and `buildSession`
 * (session-visibility.test.ts), plus the hidden-id extraction and
 * linear-conversation builders reused across session-visibility tests.
 */

const BASE_TIMESTAMP_MS = 1_700_000_000_000;
const TIMESTAMP_STEP_MS = 1_000;

function buildTimestamp(index: number): string {
  return new Date(BASE_TIMESTAMP_MS + index * TIMESTAMP_STEP_MS).toISOString();
}

function stampEntry<T extends object>(entry: T, index: number): T & { timestamp: string } {
  return { ...entry, timestamp: buildTimestamp(index) };
}

export function buildTimedSessionEntries(
  entries: readonly Omit<SessionFileEntry, "timestamp">[],
): SessionFileEntry[] {
  return entries.map(stampEntry) as SessionFileEntry[];
}

export function withTimedEntries(
  entries: readonly Omit<SessionTreeEntry, "timestamp">[],
): SessionTreeEntry[] {
  return entries.map(stampEntry) as SessionTreeEntry[];
}

type HideableSessionFileEntry = SessionFileEntry & { id?: string; hidden?: boolean };

export function extractHiddenIds(entries: readonly HideableSessionFileEntry[]): string[] {
  return entries
    .filter((entry): entry is HideableSessionFileEntry & { id: string } => "id" in entry)
    .filter((entry) => entry.hidden === true)
    .map((entry) => entry.id);
}

type LinearConversationOptions = {
  hiddenPrefix?: boolean;
};

export function buildLinearConversationSession(
  options: LinearConversationOptions = {},
): Omit<SessionFileEntry, "timestamp">[] {
  const hidden = options.hiddenPrefix === true;
  return [
    { type: "session", id: "session-1" },
    { type: "message", id: "user-1", parentId: null, hidden, message: { role: "user", content: [] } },
    {
      type: "message",
      id: "assistant-1",
      parentId: "user-1",
      hidden,
      message: { role: "assistant", content: [] },
    },
    { type: "message", id: "user-2", parentId: "assistant-1", message: { role: "user", content: [] } },
    {
      type: "message",
      id: "assistant-2",
      parentId: "user-2",
      message: { role: "assistant", content: [] },
    },
  ];
}

type ControlEntryData = {
  mode: string;
  visibleCount?: number;
  firstVisibleEntryId?: string;
};

export function buildControlEntry(
  id: string,
  parentId: string,
  data: ControlEntryData,
): Omit<SessionTreeEntry, "timestamp"> {
  return {
    type: "custom",
    id,
    parentId,
    customType: HIDE_MESSAGES_CONTROL_CUSTOM_TYPE,
    data,
  } as Omit<SessionTreeEntry, "timestamp">;
}

export function buildUserMessageEntry(
  id: string,
  parentId: string | null,
): Omit<SessionTreeEntry, "timestamp"> {
  return {
    type: "message",
    id,
    parentId,
    message: { role: "user", content: [] },
  } as Omit<SessionTreeEntry, "timestamp">;
}
