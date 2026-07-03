import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { loadHideMessagesConfig } from "./config-store.js";
import {
  HIDE_MESSAGES_CONTROL_MODE_MANUAL_HIDE,
  HIDE_MESSAGES_CONTROL_MODE_MANUAL_RESTORE,
  RESTORE_MESSAGES_COMMAND,
  RESTORE_MESSAGES_DESCRIPTION,
} from "./constants.js";
import { queueRuntimeReload } from "./reload-queue.js";
import {
  getLatestHideMessagesControlState,
  persistHideMessagesControlMode,
} from "./session-control.js";
import {
  getLiveSessionEntries,
  getSessionLeafId,
} from "./session-runtime.js";
import { applyHiddenPrefix, hasHiddenEntries } from "./session-visibility.js";
import { getErrorMessage } from "./shared/error-utils.js";
import { requireActiveSessionFile } from "./shared/session-file-guard.js";
import type { RestoreMessagesPlan, SessionTreeEntry } from "./types.js";

function buildRestoreOutcomeMessage(plan: RestoreMessagesPlan): string {
  if (!plan.changed) {
    return "restore-messages: all session entries are already visible.";
  }

  return `restore-messages: restored ${plan.restoredEntryCount} hidden session entr${plan.restoredEntryCount === 1 ? "y" : "ies"}. Reloading…`;
}

function countLegacyHiddenEntries(entries: readonly SessionTreeEntry[]): number {
  return entries.filter((entry) => entry.hidden === true).length;
}

function calculateRestorePlan(ctx: ExtensionCommandContext): RestoreMessagesPlan {
  const entries = getLiveSessionEntries(ctx);
  const leafId = getSessionLeafId(ctx);
  const controlState = getLatestHideMessagesControlState(entries, leafId);

  if (controlState?.mode === HIDE_MESSAGES_CONTROL_MODE_MANUAL_RESTORE) {
    return { changed: false, restoredEntryCount: 0 };
  }

  const legacyHiddenEntryCount = countLegacyHiddenEntries(entries);
  let hiddenPrefixEntryCount = 0;

  if (controlState?.mode === HIDE_MESSAGES_CONTROL_MODE_MANUAL_HIDE) {
    const config = loadHideMessagesConfig(ctx).config;
    hiddenPrefixEntryCount = applyHiddenPrefix(
      entries,
      controlState.visibleCount ?? config.defaultVisibleCount,
      leafId,
    ).hiddenEntryCount;
  } else {
    const config = loadHideMessagesConfig(ctx).config;
    if (config.autoHideOnSessionStart) {
      hiddenPrefixEntryCount = applyHiddenPrefix(entries, config.defaultVisibleCount, leafId).hiddenEntryCount;
    } else if (hasHiddenEntries(entries)) {
      hiddenPrefixEntryCount = legacyHiddenEntryCount;
    }
  }

  const restoredEntryCount = Math.max(legacyHiddenEntryCount, hiddenPrefixEntryCount);
  return {
    changed: restoredEntryCount > 0,
    restoredEntryCount,
  };
}

export async function handleRestoreMessagesCommand(
  pi: ExtensionAPI,
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (args.trim().length > 0) {
    ctx.ui.notify("restore-messages: this command does not accept arguments.", "warning");
    return;
  }

  const sessionFilePath = requireActiveSessionFile(ctx, "restore-messages");
  if (!sessionFilePath) {
    return;
  }

  let plan: RestoreMessagesPlan;
  try {
    plan = calculateRestorePlan(ctx);
  } catch (error) {
    const message = getErrorMessage(error);
    ctx.ui.notify(`restore-messages: failed to calculate session visibility: ${message}`, "error");
    return;
  }

  try {
    persistHideMessagesControlMode(pi, HIDE_MESSAGES_CONTROL_MODE_MANUAL_RESTORE);
  } catch (error) {
    const message = getErrorMessage(error);
    ctx.ui.notify(`restore-messages: failed to persist manual restore preference: ${message}`, "error");
    return;
  }

  ctx.ui.notify(buildRestoreOutcomeMessage(plan), "info");
  if (!plan.changed || !ctx.hasUI) {
    return;
  }

  await queueRuntimeReload(ctx, "restore-messages");
}

export function registerRestoreMessagesCommand(pi: ExtensionAPI): void {
  pi.registerCommand(RESTORE_MESSAGES_COMMAND, {
    description: RESTORE_MESSAGES_DESCRIPTION,
    handler: (args, ctx) => handleRestoreMessagesCommand(pi, args, ctx),
  });
}
