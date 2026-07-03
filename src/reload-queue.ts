import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { getErrorMessage } from "./shared/error-utils.js";

export async function queueRuntimeReload(
  ctx: Pick<ExtensionCommandContext, "ui" | "reload">,
  sourceCommand: string,
): Promise<boolean> {
  try {
    await ctx.reload();
    return true;
  } catch (error) {
    const message = getErrorMessage(error);
    ctx.ui.notify(`${sourceCommand}: automatic runtime reload failed: ${message}. Run /reload.`, "error");
    return false;
  }
}
