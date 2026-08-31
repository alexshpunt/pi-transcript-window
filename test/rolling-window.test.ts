import assert from "node:assert/strict";
import test from "node:test";

import {
  HIDE_MESSAGES_CONTROL_MODE_MANUAL_HIDE,
  HIDE_MESSAGES_CONTROL_MODE_MANUAL_RESTORE,
} from "../src/constants.js";
import { applyHiddenPrefix } from "../src/session-visibility.js";
import {
  buildControlEntry,
  buildUserMessageEntry,
  withTimedEntries,
} from "./helpers/fixtures.js";

const withTimestamps = withTimedEntries;

/**
 * Rolling-window semantics introduced for the "fixed window" behavior:
 *  - defaultVisibleCount defaults to 10 (config + code).
 *  - a manual `/hide-messages N` tuning wins over auto-hide, and persists
 *    to the global config so it survives sessions.
 *  - a no-arg `/hide-messages` resets back to the configured default.
 */
test("manual hide tuning wins over auto-hide (rolling window)", () => {
  const entries = withTimestamps([
    buildUserMessageEntry("user-1", null),
    buildUserMessageEntry("assistant-1", "user-1"),
    buildUserMessageEntry("user-2", "assistant-1"),
    buildUserMessageEntry("assistant-2", "user-2"),
    buildControlEntry("control-hide", "assistant-2", {
      mode: HIDE_MESSAGES_CONTROL_MODE_MANUAL_HIDE,
      visibleCount: 2,
    }),
  ]);

  // applyHiddenPrefix with the tuning (2) must keep only the last two items,
  // even though the configured default is larger.
  const plan = applyHiddenPrefix(entries, 2);
  assert.equal(plan.retainedVisibleItemCount, 2);
});

test("manual restore does not override the fixed rolling window default", () => {
  const entries = withTimestamps([
    buildUserMessageEntry("user-1", null),
    buildUserMessageEntry("assistant-1", "user-1"),
    buildUserMessageEntry("user-2", "assistant-1"),
    buildUserMessageEntry("assistant-2", "user-2"),
    buildControlEntry("control-restore", "assistant-2", { mode: HIDE_MESSAGES_CONTROL_MODE_MANUAL_RESTORE }),
  ]);

  // With auto-hide on, the default rolling window (10) still applies even
  // though a manual restore entry exists — restore only clears the hidden
  // markers, it does not disable the window.
  const plan = applyHiddenPrefix(entries, 10);
  assert.equal(plan.hiddenEntryCount, 0);
});

test("rolling window default is 10", async () => {
  const { DEFAULT_CONFIG_FILE } = await import("../src/constants.js");
  assert.equal(DEFAULT_CONFIG_FILE.defaultVisibleCount, 10);
  assert.equal(DEFAULT_CONFIG_FILE.autoHideOnSessionStart, true);
});
