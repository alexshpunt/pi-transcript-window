import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import {
  HIDE_MESSAGES_COMMAND,
  HIDE_MESSAGES_DESCRIPTION,
  HIDE_MESSAGES_USAGE,
  HIDE_MESSAGES_CONTROL_MODE_MANUAL_HIDE,
} from "./constants.js";
import { queueRuntimeReload } from "./reload-queue.js";
import { persistHideMessagesControlMode } from "./session-control.js";
import {
  persistDefaultVisibleCount,
  updateCachedDefaultVisibleCount,
} from "./config-store.js";
import {
  getLiveSessionEntries,
  getSessionLeafId,
} from "./session-runtime.js";
import { applyHiddenPrefix } from "./session-visibility.js";
import { getErrorMessage } from "./shared/error-utils.js";
import { requireActiveSessionFile } from "./shared/session-file-guard.js";
import type { HideMessagesPlan, HideMessagesConfigController } from "./types.js";

interface ParsedArgs {
  keepVisibleCount: number;
  usedDefault: boolean;
}

function parseArgs(args: string, defaultVisibleCount: number): ParsedArgs {
  const trimmed = args.trim();
  if (!trimmed) {
    return { keepVisibleCount: defaultVisibleCount, usedDefault: true };
  }

  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Expected a positive integer visible-count. ${HIDE_MESSAGES_USAGE}`);
  }

  const keepVisibleCount = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(keepVisibleCount) || keepVisibleCount < 1) {
    throw new Error(`Expected a positive integer visible-count. ${HIDE_MESSAGES_USAGE}`);
  }

  return { keepVisibleCount, usedDefault: false };
}

function buildHideOutcomeMessage(
  keepVisibleCount: number,
  hiddenEntryCount: number,
  totalVisibleCount: number,
  changed: boolean,
  usedDefault: boolean,
  configPath: string,
): string {
  const keptCount = Math.min(keepVisibleCount, totalVisibleCount);
  const defaultSuffix = usedDefault
    ? ` using defaultVisibleCount from ${configPath}`
    : ` (permanent: written to ${configPath})`;
  if (hiddenEntryCount === 0) {
    return changed
      ? `hide-messages: restored all ${keptCount} visible chat item(s). Reloading…`
      : `hide-messages: nothing to hide. All ${keptCount} visible chat item(s) are already retained${defaultSuffix}.`;
  }

  return `hide-messages: hid ${hiddenEntryCount} older session entr${hiddenEntryCount === 1 ? "y" : "ies"} and kept ${keptCount} visible chat item(s)${defaultSuffix}. Reloading…`;
}

/** Reset a previously tuned count back to the configured default. */
async function resetManualTuning(
  pi: ExtensionAPI,
  controller: HideMessagesConfigController,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const plan = applyHiddenPrefix(
    getLiveSessionEntries(ctx),
    controller.getConfigResult(ctx).config.defaultVisibleCount,
    getSessionLeafId(ctx),
  );
  try {
    persistHideMessagesControlMode(pi, HIDE_MESSAGES_CONTROL_MODE_MANUAL_HIDE, {
      visibleCount: controller.getConfigResult(ctx).config.defaultVisibleCount,
      firstVisibleEntryId: plan.firstVisibleEntryId,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    ctx.ui.notify(`hide-messages: failed to persist reset preference: ${message}`, "error");
    return;
  }

  ctx.ui.notify(
    `hide-messages: reset to default (${controller.getConfigResult(ctx).config.defaultVisibleCount} visible chat items). Reloading…`,
    "info",
  );
  if (plan.changed && ctx.hasUI) {
    await queueRuntimeReload(ctx, "hide-messages");
  }
}

export async function handleHideMessagesCommand(
  pi: ExtensionAPI,
  controller: HideMessagesConfigController,
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const configResult = controller.getConfigResult(ctx);
  controller.reportWarnings(ctx, configResult);

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(args, configResult.config.defaultVisibleCount);
  } catch (error) {
    ctx.ui.notify(getErrorMessage(error), "warning");
    return;
  }

  // No-arg form: reset any tuned count back to the configured default.
  if (parsed.usedDefault && args.trim().length === 0) {
    await resetManualTuning(pi, controller, ctx);
    return;
  }

  if (!parsed.usedDefault) {
    // Tuning is permanent: persist the new default to the config file that
    // currently drives the effective default (project config when present,
    // else the global config) and update the cached config so it applies
    // immediately.
    if (persistDefaultVisibleCount(configResult.config.configPath, parsed.keepVisibleCount)) {
      updateCachedDefaultVisibleCount(controller, ctx, parsed.keepVisibleCount);
    } else {
      ctx.ui.notify(
        `hide-messages: could not write ${parsed.keepVisibleCount} to ${configResult.config.configPath}; this setting will only apply to the current session.`,
        "warning",
      );
    }
  }

  const sessionFilePath = requireActiveSessionFile(ctx, "hide-messages");
  if (!sessionFilePath) {
    return;
  }

  let plan: HideMessagesPlan;
  try {
    plan = applyHiddenPrefix(
      getLiveSessionEntries(ctx),
      parsed.keepVisibleCount,
      getSessionLeafId(ctx),
    );
  } catch (error) {
    const message = getErrorMessage(error);
    ctx.ui.notify(`hide-messages: failed to calculate session visibility: ${message}`, "error");
    return;
  }

  try {
    persistHideMessagesControlMode(pi, HIDE_MESSAGES_CONTROL_MODE_MANUAL_HIDE, {
      visibleCount: parsed.keepVisibleCount,
      firstVisibleEntryId: plan.firstVisibleEntryId,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    ctx.ui.notify(`hide-messages: failed to persist manual hide preference: ${message}`, "error");
    return;
  }

  const notification = buildHideOutcomeMessage(
    parsed.keepVisibleCount,
    plan.hiddenEntryCount,
    plan.visibleItemCount,
    plan.changed,
    parsed.usedDefault,
    configResult.config.configPath,
  );
  ctx.ui.notify(notification, "info");

  if (!plan.changed || !ctx.hasUI) {
    return;
  }

  await queueRuntimeReload(ctx, "hide-messages");
}

function createHideMessagesHandler(
  pi: ExtensionAPI,
  controller: HideMessagesConfigController,
): (args: string, ctx: ExtensionCommandContext) => Promise<void> {
  return (args, ctx) => handleHideMessagesCommand(pi, controller, args, ctx);
}

export function registerHideMessagesCommand(
  pi: ExtensionAPI,
  controller: HideMessagesConfigController,
): void {
  pi.registerCommand(HIDE_MESSAGES_COMMAND, {
    description: HIDE_MESSAGES_DESCRIPTION,
    handler: createHideMessagesHandler(pi, controller),
  });
}
