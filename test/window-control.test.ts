import assert from "node:assert/strict";
import test from "node:test";

import {
  getLatestWindowControlState,
  parseWindowControlEntryData,
} from "../src/window-control.js";
import { WINDOW_CONTROL_CUSTOM_TYPE } from "../src/constants.js";
import type { SessionTreeEntry } from "../src/types.js";

function buildEntry(
  id: string,
  parentId: string | null,
  extra: Partial<SessionTreeEntry> = {},
): SessionTreeEntry {
  return {
    type: "custom",
    id,
    parentId,
    timestamp: new Date(1_700_000_000_000).toISOString(),
    customType: WINDOW_CONTROL_CUSTOM_TYPE,
    ...extra,
  } as SessionTreeEntry;
}

test("parseWindowControlEntryData accepts valid window counts", () => {
  assert.deepEqual(parseWindowControlEntryData({ mode: "window-count", count: 30 }), {
    mode: "window-count",
    count: 30,
  });
  assert.deepEqual(parseWindowControlEntryData({ mode: "window-count", count: 0 }), {
    mode: "window-count",
    count: 0,
  });
});

test("parseWindowControlEntryData rejects invalid values and clamps negatives", () => {
  assert.equal(parseWindowControlEntryData({ mode: "other", count: 5 }), null);
  assert.equal(parseWindowControlEntryData(null), null);
  assert.equal(parseWindowControlEntryData("x"), null);
  assert.deepEqual(parseWindowControlEntryData({ mode: "window-count", count: -3 }), {
    mode: "window-count",
    count: 0,
  });
});

test("getLatestWindowControlState follows the active branch", () => {
  const entries = [
    buildEntry("w-1", null, { data: { mode: "window-count", count: 10 } }),
    buildEntry("w-2", "w-1", { data: { mode: "window-count", count: 30 } }),
  ];
  assert.equal(getLatestWindowControlState(entries, "w-2")?.count, 30);
  assert.equal(getLatestWindowControlState(entries, "w-1")?.count, 10);
});

test("getLatestWindowControlState returns undefined without a window entry", () => {
  const entries = [
    {
      type: "message",
      id: "m-1",
      parentId: null,
      timestamp: new Date().toISOString(),
      message: { role: "user", content: [] },
    } as SessionTreeEntry,
  ];
  assert.equal(getLatestWindowControlState(entries, "m-1"), undefined);
});
