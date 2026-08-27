import assert from "node:assert/strict";
import test from "node:test";

import { applyHiddenPrefix, hasHiddenEntries, isSessionTreeEntry } from "../src/session-visibility.js";
import { buildLinearConversationSession, buildTimedSessionEntries, extractHiddenIds } from "./helpers/fixtures.js";

const buildSession = buildTimedSessionEntries;

test("applyHiddenPrefix hides a contiguous active-branch prefix", () => {
  const entries = buildSession(buildLinearConversationSession());

  const plan = applyHiddenPrefix(entries, 2);
  assert.equal(plan.hiddenEntryCount, 2);
  assert.equal(plan.retainedVisibleItemCount, 2);
  assert.deepEqual(extractHiddenIds(plan.entries), ["user-1", "assistant-1"]);
});

test("applyHiddenPrefix keeps assistant tool results when the assistant stays visible", () => {
  const entries = buildSession([
    { type: "session", id: "session-1" },
    {
      type: "message",
      id: "assistant-1",
      parentId: null,
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "a" } }],
      },
    },
    {
      type: "message",
      id: "tool-result-1",
      parentId: "assistant-1",
      message: { role: "toolResult", toolCallId: "call-1", content: [] },
    },
    { type: "message", id: "user-1", parentId: "tool-result-1", message: { role: "user", content: [] } },
  ]);

  const plan = applyHiddenPrefix(entries, 2);
  assert.deepEqual(extractHiddenIds(plan.entries), []);
});

test("hidden entries are filtered out of the visible entry list", () => {
  const entries = buildSession(buildLinearConversationSession({ hiddenPrefix: true }));
  const visible = entries.filter(isSessionTreeEntry).filter((entry) => entry.hidden !== true);
  assert.deepEqual(
    visible.map((entry) => entry.id),
    ["user-2", "assistant-2"],
  );
});

test("hasHiddenEntries reports hidden markers", () => {
  const entries = buildSession(buildLinearConversationSession({ hiddenPrefix: true }));
  assert.equal(hasHiddenEntries(entries.filter(isSessionTreeEntry)), true);

  const clean = buildSession(buildLinearConversationSession());
  assert.equal(hasHiddenEntries(clean.filter(isSessionTreeEntry)), false);
});

test("applyHiddenPrefix does not mutate the source entries", () => {
  const entries = buildSession(buildLinearConversationSession());
  const snapshot = JSON.stringify(entries);

  applyHiddenPrefix(entries, 2);
  assert.equal(JSON.stringify(entries), snapshot);
});
