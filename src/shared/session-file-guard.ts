import { existsSync } from "node:fs";

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/**
 * Returns the active session file path, or null when no session file is
 * active or the file has not been created yet. Sends a user notification
 * in both failure cases before returning null.
 *
 * Consolidates the session-file validation guard previously duplicated
 * between the hide-messages and restore-messages command handlers.
 */
export function requireActiveSessionFile(
  ctx: Pick<ExtensionCommandContext, "sessionManager" | "ui">,
  commandLabel: string,
): string | null {
  const sessionFilePath = ctx.sessionManager.getSessionFile();
  if (!sessionFilePath) {
    ctx.ui.notify(`${commandLabel}: no persisted session file is active.`, "error");
    return null;
  }

  if (!existsSync(sessionFilePath)) {
    ctx.ui.notify(
      `${commandLabel}: the current session file has not been created yet. Send at least one message first.`,
      "warning",
    );
    return null;
  }

  return sessionFilePath;
}
