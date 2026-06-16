import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { loadHideMessagesConfig } from "./config-store.js";
import {
  EXTENSION_ID,
  HIDE_MESSAGES_COMMAND,
  HIDE_MESSAGES_DESCRIPTION,
  RESTORE_MESSAGES_COMMAND,
  RESTORE_MESSAGES_DESCRIPTION,
} from "./constants.js";
import { registerDeferredRenderPatch } from "./render-patch.js";
import type { HideMessagesConfigLoadResult } from "./types.js";

export default function hideMessagesExtension(pi: ExtensionAPI): void {
  let cachedConfigResult: HideMessagesConfigLoadResult | null = null;
  let lastWarningFingerprint = "";

  const refreshConfig = (ctx: Pick<ExtensionContext, "cwd">): HideMessagesConfigLoadResult => {
    cachedConfigResult = loadHideMessagesConfig(ctx);
    return cachedConfigResult;
  };

  const getConfigResult = (ctx: Pick<ExtensionContext, "cwd">): HideMessagesConfigLoadResult => {
    return cachedConfigResult ?? refreshConfig(ctx);
  };

  const reportWarnings = (
    ctx: Pick<ExtensionContext, "hasUI" | "ui">,
    configResult: HideMessagesConfigLoadResult,
  ): void => {
    if (!ctx.hasUI || configResult.warnings.length === 0) {
      return;
    }

    const fingerprint = configResult.warnings.join("\n");
    if (fingerprint === lastWarningFingerprint) {
      return;
    }

    lastWarningFingerprint = fingerprint;
    for (const warning of configResult.warnings) {
      ctx.ui.notify(`${EXTENSION_ID}: ${warning}`, "warning");
    }
  };

  const configController = {
    getConfigResult,
    reportWarnings,
  };

  pi.registerCommand(HIDE_MESSAGES_COMMAND, {
    description: HIDE_MESSAGES_DESCRIPTION,
    handler: async (args, ctx) => {
      const { handleHideMessagesCommand } = await import("./command.js");
      await handleHideMessagesCommand(pi, configController, args, ctx);
    },
  });

  pi.registerCommand(RESTORE_MESSAGES_COMMAND, {
    description: RESTORE_MESSAGES_DESCRIPTION,
    handler: async (args, ctx) => {
      const { handleRestoreMessagesCommand } = await import("./restore-command.js");
      await handleRestoreMessagesCommand(pi, args, ctx);
    },
  });

  registerDeferredRenderPatch(pi);

  const syncConfig = (ctx: ExtensionContext): void => {
    const configResult = refreshConfig(ctx);
    reportWarnings(ctx, configResult);
  };

  pi.on("session_start", (_event, ctx) => {
    syncConfig(ctx);
  });
}
