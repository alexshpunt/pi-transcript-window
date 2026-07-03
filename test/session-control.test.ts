import assert from "node:assert/strict";
import test from "node:test";

import {
  HIDE_MESSAGES_CONTROL_MODE_MANUAL_HIDE,
  HIDE_MESSAGES_CONTROL_MODE_MANUAL_RESTORE,
} from "../src/constants.js";
import {
  getLatestHideMessagesControlMode,
  getLatestHideMessagesControlState,
  shouldSkipAutoHide,
} from "../src/session-control.js";
import {
  buildControlEntry,
  buildUserMessageEntry,
  withTimedEntries,
} from "./helpers/fixtures.js";

const withTimestamps = withTimedEntries;

test("manual restore control entry disables auto-hide on the active path", () => {
  const entries = withTimestamps([
    buildUserMessageEntry("user-1", null),
    buildControlEntry("control-1", "user-1", { mode: HIDE_MESSAGES_CONTROL_MODE_MANUAL_RESTORE }),
  ]);

  assert.equal(getLatestHideMessagesControlMode(entries), HIDE_MESSAGES_CONTROL_MODE_MANUAL_RESTORE);
  assert.equal(shouldSkipAutoHide(entries), true);
});

test("manual hide control entry re-enables auto-hide after a restore", () => {
  const entries = withTimestamps([
    buildUserMessageEntry("user-1", null),
    buildControlEntry("control-restore", "user-1", { mode: HIDE_MESSAGES_CONTROL_MODE_MANUAL_RESTORE }),
    buildControlEntry("control-hide", "control-restore", {
      mode: HIDE_MESSAGES_CONTROL_MODE_MANUAL_HIDE,
      visibleCount: 3,
      firstVisibleEntryId: "assistant-1",
    }),
  ]);

  const state = getLatestHideMessagesControlState(entries);
  assert.equal(getLatestHideMessagesControlMode(entries), HIDE_MESSAGES_CONTROL_MODE_MANUAL_HIDE);
  assert.equal(shouldSkipAutoHide(entries), false);
  assert.deepEqual(state, {
    mode: HIDE_MESSAGES_CONTROL_MODE_MANUAL_HIDE,
    visibleCount: 3,
    firstVisibleEntryId: "assistant-1",
  });
});
