import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { EXTENSION_ID } from "./constants.js";
import type {
  SessionTreeEntry,
  VisibleSessionContext,
} from "./types.js";

const PATCH_FLAG = "__piHideMessagesRenderPatched" as const;

type RenderSessionContext = (
  sessionContext: VisibleSessionContext,
  options?: { updateFooter?: boolean; populateHistory?: boolean },
) => void;

type PatchableInteractiveModePrototype = {
  [PATCH_FLAG]?: boolean;
  renderSessionContext?: RenderSessionContext;
  __piHideMessagesOriginalRenderSessionContext?: RenderSessionContext;
};

type InteractiveModeLike = {
  sessionManager?: {
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
  hasHiddenEntries(entries: readonly SessionTreeEntry[]): boolean;
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

function buildPatchedRender(
  originalRender: RenderSessionContext,
  visibility: VisibilityHelpers,
): RenderSessionContext {
  return function renderVisibleSessionContext(
    this: InteractiveModeLike,
    sessionContext: VisibleSessionContext,
    options?: { updateFooter?: boolean; populateHistory?: boolean },
  ): void {
    const entries = getSessionEntries(this);
    if (entries.length === 0 || !visibility.hasHiddenEntries(entries)) {
      originalRender.call(this as never, sessionContext, options);
      return;
    }

    const visibleContext = visibility.buildVisibleSessionContext(entries, getLeafId(this));
    originalRender.call(this as never, visibleContext, options);
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function applyHideMessagesRenderPatch(): Promise<RenderPatchResult> {
  try {
    const [codingAgentModule, visibility] = await Promise.all([
      import("@earendil-works/pi-coding-agent"),
      import("./session-visibility.js"),
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

    if (prototype[PATCH_FLAG]) {
      return { patched: false, alreadyPatched: true };
    }

    const originalRender = prototype.renderSessionContext;
    if (typeof originalRender !== "function") {
      return {
        patched: false,
        alreadyPatched: false,
        error: "InteractiveMode.renderSessionContext is unavailable",
      };
    }

    prototype.__piHideMessagesOriginalRenderSessionContext ??= originalRender;
    prototype.renderSessionContext = buildPatchedRender(
      prototype.__piHideMessagesOriginalRenderSessionContext,
      visibility,
    );
    prototype[PATCH_FLAG] = true;

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
