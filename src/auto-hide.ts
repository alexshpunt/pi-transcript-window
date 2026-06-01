import { existsSync } from "node:fs";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { shouldSkipAutoHide } from "./session-control.js";
import { updateSessionFileVisibility } from "./session-file.js";
import { applyHiddenPrefix } from "./session-visibility.js";
import {
  getLiveSessionEntries,
  getSessionLeafId,
  synchronizeHiddenFlags,
} from "./session-runtime.js";
import type { ResolvedHideMessagesConfig } from "./types.js";

export async function applyAutoHideToCurrentSession(
  ctx: ExtensionContext,
  config: ResolvedHideMessagesConfig,
): Promise<void> {
  if (!config.autoHideOnSessionStart) {
    return;
  }

  const sessionFilePath = ctx.sessionManager.getSessionFile();
  if (!sessionFilePath || !existsSync(sessionFilePath)) {
    return;
  }

  const liveEntries = getLiveSessionEntries(ctx);
  const leafId = getSessionLeafId(ctx);
  if (shouldSkipAutoHide(liveEntries, leafId)) {
    return;
  }

  const livePlan = applyHiddenPrefix(liveEntries, config.defaultVisibleCount, leafId);
  if (!livePlan.changed) {
    return;
  }

  const plan = updateSessionFileVisibility(
    sessionFilePath,
    config.defaultVisibleCount,
    leafId,
  );

  synchronizeHiddenFlags(liveEntries, plan.entries);
}
