import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  HIDE_MESSAGES_CONTROL_CUSTOM_TYPE,
  HIDE_MESSAGES_CONTROL_MODE_MANUAL_HIDE,
  HIDE_MESSAGES_CONTROL_MODE_MANUAL_RESTORE,
} from "./constants.js";
import { buildActivePath } from "./session-path.js";
import type {
  HideMessagesControlEntryData,
  HideMessagesControlMode,
  SessionTreeEntry,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHideMessagesControlMode(value: unknown): value is HideMessagesControlMode {
  return value === HIDE_MESSAGES_CONTROL_MODE_MANUAL_HIDE
    || value === HIDE_MESSAGES_CONTROL_MODE_MANUAL_RESTORE;
}

function parsePositiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) > 0 ? value as number : undefined;
}

function parseString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseControlEntryData(value: unknown): HideMessagesControlEntryData | null {
  if (!isRecord(value) || !isHideMessagesControlMode(value.mode)) {
    return null;
  }

  return {
    mode: value.mode,
    visibleCount: parsePositiveInteger(value.visibleCount),
    firstVisibleEntryId: parseString(value.firstVisibleEntryId),
  };
}

export function getLatestHideMessagesControlState(
  entries: readonly SessionTreeEntry[],
  leafId?: string | null,
): HideMessagesControlEntryData | undefined {
  const path = buildActivePath(entries, leafId);
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const entry = path[index];
    if (entry.type !== "custom" || entry.customType !== HIDE_MESSAGES_CONTROL_CUSTOM_TYPE) {
      continue;
    }

    const data = parseControlEntryData(entry.data);
    if (data) {
      return data;
    }
  }

  return undefined;
}

export function getLatestHideMessagesControlMode(
  entries: readonly SessionTreeEntry[],
  leafId?: string | null,
): HideMessagesControlMode | undefined {
  return getLatestHideMessagesControlState(entries, leafId)?.mode;
}

export function shouldSkipAutoHide(
  entries: readonly SessionTreeEntry[],
  leafId?: string | null,
): boolean {
  return getLatestHideMessagesControlMode(entries, leafId) === HIDE_MESSAGES_CONTROL_MODE_MANUAL_RESTORE;
}

export function persistHideMessagesControlMode(
  pi: ExtensionAPI,
  mode: HideMessagesControlMode,
  options: Pick<HideMessagesControlEntryData, "visibleCount" | "firstVisibleEntryId"> = {},
): void {
  const data: HideMessagesControlEntryData = { mode };

  if (typeof options.visibleCount === "number" && Number.isInteger(options.visibleCount) && options.visibleCount > 0) {
    data.visibleCount = options.visibleCount;
  }

  if (typeof options.firstVisibleEntryId === "string" && options.firstVisibleEntryId.length > 0) {
    data.firstVisibleEntryId = options.firstVisibleEntryId;
  }

  pi.appendEntry<HideMessagesControlEntryData>(HIDE_MESSAGES_CONTROL_CUSTOM_TYPE, data);
}
