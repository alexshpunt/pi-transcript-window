import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import {
  WINDOW_COMMAND,
  WINDOW_DESCRIPTION,
  WINDOW_USAGE,
} from "./constants.js";
import { queueRuntimeReload } from "./reload-queue.js";
import { getLiveSessionEntries, getSessionLeafId } from "./session-runtime.js";
import { getLatestWindowControlState, persistWindowControl } from "./window-control.js";
import type { HideMessagesConfigController } from "./types.js";

function formatState(ctx: ExtensionCommandContext): string {
  const state = getLatestWindowControlState(getLiveSessionEntries(ctx), getSessionLeafId(ctx));
  const count = state?.count ?? 0;
  const status =
    count > 0
      ? `ctrl+o expands the latest ${count} tool outputs`
      : "ctrl+o expands all tool outputs (no limit)";
  return `transcript window: ${status}. Usage: ${WINDOW_USAGE}`;
}

export async function handleWindowCommand(
  pi: ExtensionAPI,
  controller: HideMessagesConfigController,
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  controller.reportWarnings(ctx, controller.getConfigResult(ctx));
  const arg = args.trim();

  if (arg === "") {
    ctx.ui.notify(formatState(ctx), "info");
    return;
  }

  if (arg === "off") {
    persistWindowControl(pi, 0);
    ctx.ui.notify("transcript window: no limit — ctrl+o expands all tool outputs. Reloading…", "info");
    await queueRuntimeReload(ctx, "window");
    return;
  }

  if (!/^\d+$/.test(arg)) {
    ctx.ui.notify(`Invalid argument. ${WINDOW_USAGE}`, "warning");
    return;
  }

  const count = Number.parseInt(arg, 10);
  if (!Number.isInteger(count) || count < 1) {
    ctx.ui.notify(`Invalid window size. ${WINDOW_USAGE}`, "warning");
    return;
  }

  persistWindowControl(pi, count);
  ctx.ui.notify(`transcript window: ctrl+o will expand the latest ${count} tool outputs. Reloading…`, "info");
  await queueRuntimeReload(ctx, "window");
}

export function registerWindowCommand(
  pi: ExtensionAPI,
  controller: HideMessagesConfigController,
): void {
  pi.registerCommand(WINDOW_COMMAND, {
    description: WINDOW_DESCRIPTION,
    handler: (args, ctx) => handleWindowCommand(pi, controller, args, ctx),
  });
}
