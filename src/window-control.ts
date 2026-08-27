import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  EXTENSION_ID,
  WINDOW_CONTROL_CUSTOM_TYPE,
} from "./constants.js";
import { getErrorMessage } from "./shared/error-utils.js";
import { isRecord } from "./shared/record-utils.js";
import type { SessionTreeEntry } from "./types.js";

const PATCH_FLAG = "__piTranscriptWindowExpansionPatched" as const;
const PATCH_VERSION = 1;

/** Expandable chat item (has setExpanded, like ToolExecutionComponent). */
interface ExpandableItem {
  setExpanded(expanded: boolean): void;
}

function isExpandable(value: unknown): value is ExpandableItem {
  return (
    typeof value === "object" &&
    value !== null &&
    "setExpanded" in value &&
    typeof (value as ExpandableItem).setExpanded === "function"
  );
}

/**
 * A tool-execution component: ToolExecutionComponent instances carry a
 * `toolName` string. Assistant/user messages are not tools and are excluded
 * from the window count.
 *
 * With cc-style rendering, only bash has expandable output (read/write/update
 * are one-line summaries), so the window counts only bash by default.
 */
function isToolComponent(value: unknown): value is ExpandableItem {
  return isExpandable(value) && typeof (value as { toolName?: unknown }).toolName === "string";
}

/** Whether a tool component is one we count toward the window. */
function isCountedTool(value: unknown): value is ExpandableItem {
  return isToolComponent(value) && (value as { toolName?: unknown }).toolName === "bash";
}

/**
 * Window state persisted as a session control entry, so it follows the
 * active branch across /resume, /new, /fork. `count` of 0 means "no limit"
 * (ctrl+o expands everything, pi's default behavior).
 */
export interface WindowControlEntryData {
  mode: "window-count";
  count: number;
}

export function parseWindowControlEntryData(value: unknown): WindowControlEntryData | null {
  if (!isRecord(value) || value.mode !== "window-count") {
    return null;
  }
  const count = typeof value.count === "number" && Number.isInteger(value.count) ? value.count : 0;
  return { mode: "window-count", count: Math.max(0, count) };
}

export function getLatestWindowControlState(
  entries: readonly SessionTreeEntry[],
  leafId?: string | null,
): WindowControlEntryData | undefined {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let current = leafId ? byId.get(leafId) : undefined;
  current ??= entries[entries.length - 1];

  while (current) {
    if (current.type === "custom" && current.customType === WINDOW_CONTROL_CUSTOM_TYPE) {
      const data = parseWindowControlEntryData(current.data);
      if (data) {
        return data;
      }
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return undefined;
}

export function persistWindowControl(pi: ExtensionAPI, count: number): void {
  pi.appendEntry<WindowControlEntryData>(WINDOW_CONTROL_CUSTOM_TYPE, { mode: "window-count", count });
}

/**
 * Resolve the tool components in a chat container, following nested
 * containers. Only counted tool components (bash by default) count toward
 * the window; other expandable items are left to pi's default behavior.
 */
function collectToolComponents(children: readonly unknown[]): ExpandableItem[] {
  const items: ExpandableItem[] = [];
  const visit = (node: unknown): void => {
    if (isCountedTool(node)) {
      items.push(node);
      return;
    }
    if (typeof node === "object" && node !== null && "children" in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  for (const child of children) {
    visit(child);
  }
  return items;
}

/** Set expand/collapse on every expandable item in a container (pi default). */
function setAllExpandable(children: readonly unknown[], expanded: boolean): void {
  const visit = (node: unknown): void => {
    if (isExpandable(node)) {
      node.setExpanded(expanded);
      return;
    }
    if (typeof node === "object" && node !== null && "children" in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  for (const child of children) {
    visit(child);
  }
}

type SetToolsExpanded = (expanded: boolean) => void;

type PatchableInteractiveModePrototype = {
  [PATCH_FLAG]?: boolean;
  setToolsExpanded?: SetToolsExpanded;
  __piTranscriptWindowOriginalSetToolsExpanded?: SetToolsExpanded;
  __piTranscriptWindowExpansionPatchVersion?: number;
};

type InteractiveModeLike = {
  toolOutputExpanded?: boolean;
  chatContainer?: { children: unknown[] };
  loadedResourcesContainer?: { children: unknown[] };
  showStatus?(message: string): void;
  sessionManager?: {
    getEntries?: () => SessionTreeEntry[];
    getLeafId?: () => string | null | undefined;
  };
};

type InteractiveModeConstructor = { prototype: PatchableInteractiveModePrototype };

export interface WindowPatchResult {
  patched: boolean;
  alreadyPatched: boolean;
  error?: string;
}

function resolveWindowCount(instance: InteractiveModeLike): number {
  const entries = instance.sessionManager?.getEntries?.() ?? [];
  if (entries.length === 0) {
    return 0;
  }
  const leafId = instance.sessionManager?.getLeafId?.();
  return getLatestWindowControlState(entries, leafId)?.count ?? 0;
}

function buildPatchedSetToolsExpanded(original: SetToolsExpanded): SetToolsExpanded {
  return function patchedSetToolsExpanded(this: InteractiveModeLike, expanded: boolean): void {
    const count = resolveWindowCount(this);

    // No window configured (count 0): pi's default behavior.
    if (count <= 0) {
      if (!expanded) {
        original.call(this as never, expanded);
        return;
      }
      // /window off: restore full expansion. The original implementation
      // short-circuits when toolOutputExpanded is already true, which would
      // skip re-expanding tools after a windowed expansion. Force it.
      if (this.toolOutputExpanded === true) {
        this.toolOutputExpanded = false;
        original.call(this as never, true);
        return;
      }
      original.call(this as never, expanded);
      return;
    }

    if (!expanded) {
      original.call(this as never, expanded);
      return;
    }

    // Expand: only the newest `count` tool components expand; older tools
    // stay collapsed. Non-tool expandable items (messages, headers) follow
    // pi's default behavior.
    this.toolOutputExpanded = true;
    const tools = collectToolComponents(this.chatContainer?.children ?? []);
    const newestTools = tools.slice(-count);
    const newestToolSet = new Set(newestTools);

    for (const child of this.chatContainer?.children ?? []) {
      const visit = (node: unknown): void => {
        if (isCountedTool(node)) {
          node.setExpanded(newestToolSet.has(node));
          return;
        }
        if (isToolComponent(node)) {
          // Non-bash tools (read/write/update): pi default (expand).
          node.setExpanded(true);
          return;
        }
        if (isExpandable(node)) {
          // Non-tool expandable (messages etc.): pi default (expand).
          node.setExpanded(true);
          return;
        }
        if (typeof node === "object" && node !== null && "children" in node && Array.isArray(node.children)) {
          for (const c of node.children) {
            visit(c);
          }
        }
      };
      visit(child);
    }

    if (this.loadedResourcesContainer) {
      setAllExpandable(this.loadedResourcesContainer.children, true);
    }

    this.showStatus?.(`Tool output: expanded (latest ${count})`);
  };
}

export async function applyWindowExpansionPatch(): Promise<WindowPatchResult> {
  try {
    const codingAgentModule = await import("@earendil-works/pi-coding-agent");
    const InteractiveMode = (codingAgentModule as { InteractiveMode?: InteractiveModeConstructor }).InteractiveMode;
    const prototype = InteractiveMode?.prototype;
    if (!prototype) {
      return { patched: false, alreadyPatched: false, error: "InteractiveMode is unavailable" };
    }

    if (prototype[PATCH_FLAG] && prototype.__piTranscriptWindowExpansionPatchVersion === PATCH_VERSION) {
      return { patched: false, alreadyPatched: true };
    }

    const original = prototype.__piTranscriptWindowOriginalSetToolsExpanded ?? prototype.setToolsExpanded;
    if (typeof original !== "function") {
      return { patched: false, alreadyPatched: false, error: "InteractiveMode.setToolsExpanded is unavailable" };
    }

    prototype.__piTranscriptWindowOriginalSetToolsExpanded = original;
    prototype.setToolsExpanded = buildPatchedSetToolsExpanded(original);
    prototype[PATCH_FLAG] = true;
    prototype.__piTranscriptWindowExpansionPatchVersion = PATCH_VERSION;

    return { patched: true, alreadyPatched: false };
  } catch (error) {
    return { patched: false, alreadyPatched: false, error: getErrorMessage(error) };
  }
}

export function registerDeferredWindowPatch(pi: ExtensionAPI): void {
  let attempted = false;
  let warned = false;

  pi.on("session_start", async (_event, ctx) => {
    if (attempted) {
      return;
    }
    attempted = true;
    const patchResult = await applyWindowExpansionPatch();
    if (patchResult.patched || patchResult.alreadyPatched || warned || !ctx.hasUI) {
      return;
    }
    warned = true;
    ctx.ui.notify(
      `${EXTENSION_ID}: failed to patch tool expansion window (${patchResult.error ?? "unknown error"})`,
      "warning",
    );
  });
}
