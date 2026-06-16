import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { SessionTreeEntry } from "./types.js";

export function getSessionLeafId(
  ctx: Pick<ExtensionContext | ExtensionCommandContext, "sessionManager">,
): string | null | undefined {
  const manager = ctx.sessionManager as {
    getLeafId?: () => string | null | undefined;
  };

  return typeof manager.getLeafId === "function" ? manager.getLeafId() : undefined;
}

export function getLiveSessionEntries(
  ctx: Pick<ExtensionContext | ExtensionCommandContext, "sessionManager">,
): SessionTreeEntry[] {
  return ctx.sessionManager.getEntries() as SessionTreeEntry[];
}
