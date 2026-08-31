import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  DEFAULT_CONFIG_FILE,
  EXTENSION_ID,
  HIDE_MESSAGES_CONTROL_MODE_MANUAL_HIDE,
  HIDE_MESSAGES_CONTROL_MODE_MANUAL_RESTORE,
} from "./constants.js";
import { getErrorMessage } from "./shared/error-utils.js";
import type {
  HideMessagesConfigLoadResult,
  HideMessagesControlEntryData,
  HideMessagesPlan,
  SessionFileEntry,
  SessionTreeEntry,
} from "./types.js";

const PATCH_FLAG = "__piHideMessagesRenderPatched" as const;
const PATCH_VERSION = 3;

/** pi 0.84+ renders session entries (not a prebuilt message context). */
type RenderSessionEntries = (
  entries: readonly SessionTreeEntry[],
  options?: { updateFooter?: boolean; populateHistory?: boolean },
) => void;

type PatchableInteractiveModePrototype = {
  [PATCH_FLAG]?: boolean;
  renderSessionEntries?: RenderSessionEntries;
  __piHideMessagesOriginalRenderSessionEntries?: RenderSessionEntries;
  __piHideMessagesRenderPatchVersion?: number;
};

type InteractiveModeLike = {
  sessionManager?: {
    getCwd?: () => string;
    getEntries?: () => SessionTreeEntry[];
    getLeafId?: () => string | null | undefined;
  };
};

type InteractiveModeConstructor = { prototype: PatchableInteractiveModePrototype };

interface VisibilityHelpers {
  applyHiddenPrefix(
    entries: readonly SessionTreeEntry[],
    keepVisibleCount: number,
    leafId?: string | null,
  ): HideMessagesPlan;
  hasHiddenEntries(entries: readonly SessionTreeEntry[]): boolean;
}

interface ControlHelpers {
  getLatestHideMessagesControlState(
    entries: readonly SessionTreeEntry[],
    leafId?: string | null,
  ): HideMessagesControlEntryData | undefined;
}

interface ConfigHelpers {
  loadHideMessagesConfig(ctx: { cwd: string }): HideMessagesConfigLoadResult;
}

export interface RenderPatchResult {
  patched: boolean;
  alreadyPatched: boolean;
  error?: string;
}

function getSessionEntries(instance: InteractiveModeLike): SessionTreeEntry[] {
  return instance.sessionManager?.getEntries?.() ?? [];
}

function getLeafId(instance: InteractiveModeLike): string | null | undefined {
  return instance.sessionManager?.getLeafId?.();
}

function loadConfig(instance: InteractiveModeLike, config: ConfigHelpers): HideMessagesConfigLoadResult["config"] {
  try {
    return config.loadHideMessagesConfig({ cwd: instance.sessionManager?.getCwd?.() ?? process.cwd() }).config;
  } catch {
    return { ...DEFAULT_CONFIG_FILE, configPath: "<defaults>" };
  }
}

/**
 * Decide which entries should be hidden for this render. Returns undefined
 * when nothing should change (manual restore, or nothing hidden).
 */
function resolveHiddenPlan(
  instance: InteractiveModeLike,
  visibility: VisibilityHelpers,
  controls: ControlHelpers,
  config: ConfigHelpers,
): HideMessagesPlan | undefined {
  const entries = getSessionEntries(instance);
  if (entries.length === 0) {
    return undefined;
  }

  const leafId = getLeafId(instance);
  const resolvedConfig = loadConfig(instance, config);
  const controlState = controls.getLatestHideMessagesControlState(entries, leafId);

  // Manual tuning wins: once you set a count with /hide-messages N it stays
  // effective (persisted in the session) until you reset it with
  // /hide-messages (no arg).
  if (controlState?.mode === HIDE_MESSAGES_CONTROL_MODE_MANUAL_HIDE) {
    const visibleCount = controlState.visibleCount ?? resolvedConfig.defaultVisibleCount;
    return visibility.applyHiddenPrefix(entries, visibleCount, leafId);
  }

  if (controlState?.mode === HIDE_MESSAGES_CONTROL_MODE_MANUAL_RESTORE) {
    return undefined;
  }

  // Fixed rolling window: when auto-hide is on it always wins, so a manual
  // restore persisted in an older session can no longer disable it. Every
  // session (new or resumed) shows the latest defaultVisibleCount items.
  if (resolvedConfig.autoHideOnSessionStart) {
    return visibility.applyHiddenPrefix(entries, resolvedConfig.defaultVisibleCount, leafId);
  }

  if (visibility.hasHiddenEntries(entries)) {
    // Auto-hide off but older entries are still marked hidden: keep them
    // hidden (they will be filtered out) without recomputing a prefix.
    return {
      entries,
      changed: false,
      hiddenEntryCount: 0,
      visibleItemCount: 0,
      retainedVisibleItemCount: 0,
    };
  }

  return undefined;
}

function filterHiddenEntries(entries: readonly SessionFileEntry[]): SessionTreeEntry[] {
  return entries
    .filter((entry): entry is SessionTreeEntry => entry.type !== "session")
    .filter((entry) => entry.hidden !== true);
}

function buildPatchedRender(
  originalRender: RenderSessionEntries,
  visibility: VisibilityHelpers,
  controls: ControlHelpers,
  config: ConfigHelpers,
): RenderSessionEntries {
  return function renderVisibleSessionEntries(
    this: InteractiveModeLike,
    entries: readonly SessionTreeEntry[],
    options?: { updateFooter?: boolean; populateHistory?: boolean },
  ): void {
    const plan = resolveHiddenPlan(this, visibility, controls, config);
    const visibleEntries = plan ? filterHiddenEntries(plan.entries) : entries;
    originalRender.call(this as never, visibleEntries, options);
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
      return { patched: false, alreadyPatched: false, error: "InteractiveMode is unavailable" };
    }

    if (prototype[PATCH_FLAG] && prototype.__piHideMessagesRenderPatchVersion === PATCH_VERSION) {
      return { patched: false, alreadyPatched: true };
    }

    const originalRender =
      prototype.__piHideMessagesOriginalRenderSessionEntries ?? prototype.renderSessionEntries;
    if (typeof originalRender !== "function") {
      return {
        patched: false,
        alreadyPatched: false,
        error: "InteractiveMode.renderSessionEntries is unavailable",
      };
    }

    prototype.__piHideMessagesOriginalRenderSessionEntries = originalRender;
    prototype.renderSessionEntries = buildPatchedRender(originalRender, visibility, controls, config);
    prototype[PATCH_FLAG] = true;
    prototype.__piHideMessagesRenderPatchVersion = PATCH_VERSION;

    return { patched: true, alreadyPatched: false };
  } catch (error) {
    return { patched: false, alreadyPatched: false, error: getErrorMessage(error) };
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
