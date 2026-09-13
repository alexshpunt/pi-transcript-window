import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { InteractiveMode } from "@earendil-works/pi-coding-agent";

import { CONFIG_BASENAME, EXTENSION_ID } from "../src/constants.js";
import { applyHideMessagesRenderPatch } from "../src/render-patch.js";
import type { SessionTreeEntry } from "../src/types.js";
import { buildUserMessageEntry, withTimedEntries } from "./helpers/fixtures.js";

/**
 * Pi calls `renderSessionEntries` with two different entry lists:
 *  - the active session path (session start, resume, branch navigation);
 *  - a compaction-aware subset right after compaction, with the compaction
 *    entry removed because Pi appends its own `[compaction]` box afterwards.
 *
 * The patch must only hide entries; it must never replace the caller's list
 * with the full session path. That replacement drew the compaction box twice
 * and resurrected summarized pre-compaction history.
 */

const AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-transcript-window-agent-"));
process.env.PI_CODING_AGENT_DIR = AGENT_DIR;

/** The module's .d.ts hides these members; the patch reaches them the same way. */
type PatchableInteractiveMode = {
  prototype: {
    renderSessionEntries: (entries: readonly SessionTreeEntry[], options?: unknown) => void;
  };
};

const interactiveModePrototype = (InteractiveMode as unknown as PatchableInteractiveMode).prototype;

interface RenderedCall {
  entries: SessionTreeEntry[];
  options: unknown;
}

const rendered: RenderedCall[] = [];
const originalRender = function renderSessionEntries(
  this: unknown,
  entries: readonly SessionTreeEntry[],
  options?: unknown,
): void {
  rendered.push({ entries: [...entries], options });
};
interactiveModePrototype.renderSessionEntries = originalRender;

const patchResult = await applyHideMessagesRenderPatch();
assert.equal(patchResult.patched, true, `render patch failed: ${patchResult.error ?? "unknown"}`);

function buildCompactionEntry(id: string, parentId: string, firstKeptEntryId: string) {
  return {
    type: "compaction",
    id,
    parentId,
    timestamp: new Date(0).toISOString(),
    summary: "summary",
    firstKeptEntryId,
    tokensBefore: 383799,
  } as SessionTreeEntry;
}

/** Render entries for a session whose project config sets the given options. */
function renderWithConfig(
  path: readonly SessionTreeEntry[],
  callerEntries: readonly SessionTreeEntry[],
  config: Record<string, unknown>,
): RenderedCall {
  const cwd = mkdtempSync(join(tmpdir(), "pi-transcript-window-cwd-"));
  const configDir = join(cwd, ".pi", "extensions", EXTENSION_ID);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, CONFIG_BASENAME), `${JSON.stringify(config)}\n`, "utf-8");

  const instance = {
    sessionManager: {
      getEntries: () => [...path],
      getLeafId: () => path[path.length - 1]?.id,
      getCwd: () => cwd,
    },
  };

  rendered.length = 0;
  interactiveModePrototype.renderSessionEntries.call(instance as never, callerEntries);
  assert.equal(rendered.length, 1, "expected exactly one render");
  return rendered[0];
}

function ids(call: RenderedCall): string[] {
  return call.entries.map((entry) => entry.id);
}

test("compaction render stays without the compaction entry Pi re-adds itself", () => {
  const user1 = withTimedEntries([buildUserMessageEntry("user-1", null)])[0];
  const user2 = withTimedEntries([buildUserMessageEntry("user-2", "user-1")])[0];
  const compaction = buildCompactionEntry("compaction-1", "user-2", "user-2");

  // Pi's compaction_end call: buildContextEntries().slice(1).
  const call = renderWithConfig([user1, user2, compaction], [user2], {
    autoHideOnSessionStart: true,
    defaultVisibleCount: 10,
  });

  assert.deepEqual(ids(call), ["user-2"]);
});

test("compaction-aware context keeps the compaction first and drops summarized history", () => {
  const user1 = withTimedEntries([buildUserMessageEntry("user-1", null)])[0];
  const user2 = withTimedEntries([buildUserMessageEntry("user-2", "user-1")])[0];
  const compaction = buildCompactionEntry("compaction-1", "user-2", "user-2");

  // What Pi passes on session start: the compaction-aware context entries.
  const call = renderWithConfig([user1, user2, compaction], [compaction, user2], {
    autoHideOnSessionStart: true,
    defaultVisibleCount: 10,
  });

  assert.deepEqual(ids(call), ["compaction-1", "user-2"]);
});

test("active path rendering still hides everything but the newest visible items", () => {
  const path = withTimedEntries([
    buildUserMessageEntry("user-1", null),
    buildUserMessageEntry("user-2", "user-1"),
    buildUserMessageEntry("user-3", "user-2"),
    buildUserMessageEntry("user-4", "user-3"),
  ]);

  const call = renderWithConfig(path, path, { autoHideOnSessionStart: true, defaultVisibleCount: 2 });

  assert.deepEqual(ids(call), ["user-3", "user-4"]);
});

test("hidden prefix is not resurrected into a shorter caller list", () => {
  const path = withTimedEntries([
    buildUserMessageEntry("user-1", null),
    buildUserMessageEntry("user-2", "user-1"),
    buildUserMessageEntry("user-3", "user-2"),
    buildUserMessageEntry("user-4", "user-3"),
  ]);

  const call = renderWithConfig(path, [path[3]], {
    autoHideOnSessionStart: true,
    defaultVisibleCount: 2,
  });

  assert.deepEqual(ids(call), ["user-4"]);
});

test("auto-hide off leaves the caller list untouched", () => {
  const path = withTimedEntries([
    buildUserMessageEntry("user-1", null),
    buildUserMessageEntry("user-2", "user-1"),
    buildUserMessageEntry("user-3", "user-2"),
  ]);

  const call = renderWithConfig(path, [path[2]], {
    autoHideOnSessionStart: false,
    defaultVisibleCount: 1,
  });

  assert.deepEqual(ids(call), ["user-3"]);
});
