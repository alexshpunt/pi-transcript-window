import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  DEFAULT_CONFIG_FILE,
  EXTENSION_ID,
  HIDE_MESSAGES_CONTROL_MODE_MANUAL_HIDE,
  HIDE_MESSAGES_CONTROL_MODE_MANUAL_RESTORE,
} from "./constants.js";
import { getErrorMessage } from "./shared/error-utils.js";
import type {
  HideMessagesControlEntryData,
  HideMessagesConfigLoadResult,
  SessionTreeEntry,
  VisibleSessionContext,
} from "./types.js";

const PATCH_FLAG = "__piHideMessagesRenderPatched" as const;
const PATCH_VERSION = 2;

type RenderSessionContext = (
  sessionContext: VisibleSessionContext,
  options?: { updateFooter?: boolean; populateHistory?: boolean },
) => void;

type PatchableInteractiveModePrototype = {
  [PATCH_FLAG]?: boolean;
  renderSessionContext?: RenderSessionContext;
  __piHideMessagesOriginalRenderSessionContext?: RenderSessionContext;
  __piHideMessagesRenderPatchVersion?: number;
};

type InteractiveModeLike = {
  sessionManager?: {
    getCwd?: () => string;
    getEntries?: () => unknown[];
    getLeafId?: () => string | null | undefined;
  };
};

type InteractiveModeConstructor = {
  prototype: PatchableInteractiveModePrototype;
};

type VisibilityHelpers = {
  buildVisibleSessionContext(
    entries: readonly SessionTreeEntry[],
    leafId?: string | null,
  ): VisibleSessionContext;
  buildVisibleSessionContextWithHiddenPrefix(
    entries: readonly SessionTreeEntry[],
    keepVisibleCount: number,
    leafId?: string | null,
  ): VisibleSessionContext;
  hasHiddenEntries(entries: readonly SessionTreeEntry[]): boolean;
};

type ControlHelpers = {
  getLatestHideMessagesControlState(
    entries: readonly SessionTreeEntry[],
    leafId?: string | null,
  ): HideMessagesControlEntryData | undefined;
};

type ConfigHelpers = {
  loadHideMessagesConfig(ctx: { cwd: string }): HideMessagesConfigLoadResult;
};

export interface RenderPatchResult {
  patched: boolean;
  alreadyPatched: boolean;
  error?: string;
}

function getSessionEntries(instance: InteractiveModeLike): SessionTreeEntry[] {
  const getEntries = instance.sessionManager?.getEntries;
  if (typeof getEntries !== "function") {
    return [];
  }

  return getEntries.call(instance.sessionManager) as SessionTreeEntry[];
}

function getLeafId(instance: InteractiveModeLike): string | null | undefined {
  const leafIdGetter = instance.sessionManager?.getLeafId;
  if (typeof leafIdGetter !== "function") {
    return undefined;
  }

  return leafIdGetter.call(instance.sessionManager) as string | null | undefined;
}

function getCwd(instance: InteractiveModeLike): string {
  const cwdGetter = instance.sessionManager?.getCwd;
  if (typeof cwdGetter !== "function") {
    return process.cwd();
  }

  return cwdGetter.call(instance.sessionManager) || process.cwd();
}

function loadConfig(instance: InteractiveModeLike, config: ConfigHelpers): HideMessagesConfigLoadResult["config"] {
  try {
    return config.loadHideMessagesConfig({ cwd: getCwd(instance) }).config;
  } catch {
    return {
      configPath: "<defaults>",
      enabled: DEFAULT_CONFIG_FILE.enabled,
      debug: DEFAULT_CONFIG_FILE.debug,
      defaultVisibleCount: DEFAULT_CONFIG_FILE.defaultVisibleCount,
      autoHideOnSessionStart: DEFAULT_CONFIG_FILE.autoHideOnSessionStart,
    };
  }
}

function resolveVisibleContext(
  instance: InteractiveModeLike,
  sessionContext: VisibleSessionContext,
  visibility: VisibilityHelpers,
  controls: ControlHelpers,
  config: ConfigHelpers,
): VisibleSessionContext {
  const entries = getSessionEntries(instance);
  if (entries.length === 0) {
    return sessionContext;
  }

  const leafId = getLeafId(instance);
  const controlState = controls.getLatestHideMessagesControlState(entries, leafId);
  if (controlState?.mode === HIDE_MESSAGES_CONTROL_MODE_MANUAL_RESTORE) {
    return sessionContext;
  }

  if (controlState?.mode === HIDE_MESSAGES_CONTROL_MODE_MANUAL_HIDE) {
    const resolvedConfig = loadConfig(instance, config);
    const visibleCount = controlState.visibleCount ?? resolvedConfig.defaultVisibleCount;
    return visibility.buildVisibleSessionContextWithHiddenPrefix(entries, visibleCount, leafId);
  }

  const resolvedConfig = loadConfig(instance, config);
  if (resolvedConfig.autoHideOnSessionStart) {
    return visibility.buildVisibleSessionContextWithHiddenPrefix(
      entries,
      resolvedConfig.defaultVisibleCount,
      leafId,
    );
  }

  if (visibility.hasHiddenEntries(entries)) {
    return visibility.buildVisibleSessionContext(entries, leafId);
  }

  return sessionContext;
}

function buildPatchedRender(
  originalRender: RenderSessionContext,
  visibility: VisibilityHelpers,
  controls: ControlHelpers,
  config: ConfigHelpers,
): RenderSessionContext {
  return function renderVisibleSessionContext(
    this: InteractiveModeLike,
    sessionContext: VisibleSessionContext,
    options?: { updateFooter?: boolean; populateHistory?: boolean },
  ): void {
    const visibleContext = resolveVisibleContext(this, sessionContext, visibility, controls, config);
    originalRender.call(this as never, visibleContext, options);
  };
}

export async function applyHideMessagesRenderPatch(): Promise<RenderPatchResult> {
  try {
    const [codingAgentModule, visibility, controls, config] = await Promise.all([
      import("@earendil-works/pi-coding-agent"),
      import("./session-visibility.js"),
      import("./session-control.js"),
      import("./config-store.js"),
    ]);
    const InteractiveMode = (codingAgentModule as { InteractiveMode?: InteractiveModeConstructor }).InteractiveMode;
    const prototype = InteractiveMode?.prototype;

    if (!prototype) {
      return {
        patched: false,
        alreadyPatched: false,
        error: "InteractiveMode is unavailable",
      };
    }

    if (prototype[PATCH_FLAG] && prototype.__piHideMessagesRenderPatchVersion === PATCH_VERSION) {
      return { patched: false, alreadyPatched: true };
    }

    const savedOriginalRender = prototype.__piHideMessagesOriginalRenderSessionContext;
    const currentRender = prototype.renderSessionContext;
    const originalRender = typeof savedOriginalRender === "function" ? savedOriginalRender : currentRender;
    if (typeof originalRender !== "function") {
      return {
        patched: false,
        alreadyPatched: false,
        error: "InteractiveMode.renderSessionContext is unavailable",
      };
    }

    prototype.__piHideMessagesOriginalRenderSessionContext = originalRender;
    prototype.renderSessionContext = buildPatchedRender(
      originalRender,
      visibility,
      controls,
      config,
    );
    prototype[PATCH_FLAG] = true;
    prototype.__piHideMessagesRenderPatchVersion = PATCH_VERSION;

    return { patched: true, alreadyPatched: false };
  } catch (error) {
    return {
      patched: false,
      alreadyPatched: false,
      error: getErrorMessage(error),
    };
  }
}

export function registerDeferredRenderPatch(pi: ExtensionAPI): void {
  let attempted = false;
  let warned = false;

  pi.on("session_start", async (_event, ctx) => {
    if (attempted) {
      return;
    }

    attempted = true;
    const patchResult = await applyHideMessagesRenderPatch();
    if (patchResult.patched || patchResult.alreadyPatched || warned || !ctx.hasUI) {
      return;
    }

    warned = true;
    ctx.ui.notify(
      `${EXTENSION_ID}: failed to patch TUI message rendering (${patchResult.error ?? "unknown error"})`,
      "warning",
    );
  });
}
