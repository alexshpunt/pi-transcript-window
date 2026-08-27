import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  HIDE_MESSAGES_COMMAND,
  HIDE_MESSAGES_CONTROL_CUSTOM_TYPE,
  HIDE_MESSAGES_CONTROL_MODE_MANUAL_HIDE,
  HIDE_MESSAGES_CONTROL_MODE_MANUAL_RESTORE,
  RESTORE_MESSAGES_COMMAND,
} from "../src/constants.js";
import type { HideMessagesControlEntryData, SessionFileEntry, SessionTreeEntry } from "../src/types.js";

const distRoot = fileURLToPath(new URL("..", import.meta.url));
const patchFlag = "__piHideMessagesRenderPatched";
const patchVersionKey = "__piHideMessagesRenderPatchVersion";
const originalRenderKey = "__piHideMessagesOriginalRenderSessionEntries";

type NotificationLevel = "info" | "warning" | "error";

type Notification = { level: NotificationLevel; message: string };

type RuntimeState = {
  cwd: string;
  leafId: string | null;
  liveEntries: SessionTreeEntry[];
};

type StubInteractiveMode = {
  renderCalls?: Array<{ entries: readonly SessionTreeEntry[]; options?: Record<string, unknown> }>;
  lastRender?: { entries: readonly SessionTreeEntry[]; options?: Record<string, unknown> };
  renderSessionEntries?(
    entries: readonly SessionTreeEntry[],
    options?: { populateHistory?: boolean; updateFooter?: boolean },
  ): void;
  sessionManager?: {
    getCwd(): string;
    getEntries(): SessionTreeEntry[];
    getLeafId(): string | null;
  };
};

type RegisteredCommand = {
  description: string;
  handler: (args: string, ctx: CommandContextStub) => Promise<void> | void;
};

function parseJsonlSession(content: string): SessionFileEntry[] {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as SessionFileEntry);
}

function serializeJsonlSession(entries: readonly SessionFileEntry[]): string {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

type CommandContextStub = {
  cwd: string;
  hasUI: boolean;
  reload(): Promise<void>;
  sessionManager: {
    getEntries(): SessionTreeEntry[];
    getLeafId(): string | null;
    getSessionFile(): string;
  };
  ui: { notify(message: string, level?: NotificationLevel): void };
};

function createTempRoot(label: string): string {
  const root = join(
    distRoot,
    ".test-tmp",
    `${label}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  return root;
}

function installPiCodingAgentStub(stubPackageRoot: string): void {
  mkdirSync(stubPackageRoot, { recursive: true });
  writeFileSync(
    join(stubPackageRoot, "package.json"),
    JSON.stringify({ name: "@earendil-works/pi-coding-agent", type: "module", exports: "./index.js" }, null, 2),
    "utf-8",
  );
  writeFileSync(
    join(stubPackageRoot, "index.js"),
    [
      "export class InteractiveMode {",
      "  renderSessionEntries(entries, options) {",
      "    const call = { entries, options };",
      "    if (!Array.isArray(this.renderCalls)) {",
      "      this.renderCalls = [];",
      "    }",
      "    this.renderCalls.push(call);",
      "    this.lastRender = call;",
      "  }",
      "}",
    ].join("\n"),
    "utf-8",
  );
}

function resetInteractiveModePrototype(InteractiveMode: { prototype: StubInteractiveMode }): void {
  const prototype = InteractiveMode.prototype as StubInteractiveMode & Record<string, unknown>;
  delete prototype[patchFlag];
  delete prototype[patchVersionKey];
  delete prototype[originalRenderKey];
  prototype.renderSessionEntries = function renderSessionEntries(
    this: StubInteractiveMode,
    entries: readonly SessionTreeEntry[],
    options?: { populateHistory?: boolean; updateFooter?: boolean },
  ): void {
    const call = { entries, options };
    if (!Array.isArray(this.renderCalls)) {
      this.renderCalls = [];
    }
    this.renderCalls.push(call);
    this.lastRender = call;
  };
}

function buildSessionEntries(): SessionFileEntry[] {
  const start = 1_700_000_000_000;
  const messages: Array<{ id: string; parentId: string | null; role: string }> = [
    { id: "user-1", parentId: null, role: "user" },
    { id: "assistant-1", parentId: "user-1", role: "assistant" },
    { id: "user-2", parentId: "assistant-1", role: "user" },
    { id: "assistant-2", parentId: "user-2", role: "assistant" },
  ];

  return [
    { type: "session", id: "session-1", cwd: "C:/runtime-validation" },
    ...messages.map((entry, index) => ({
      type: "message" as const,
      id: entry.id,
      parentId: entry.parentId,
      timestamp: new Date(start + index * 1_000).toISOString(),
      message: { role: entry.role, content: [] },
    })),
  ];
}

function readTreeEntries(sessionFilePath: string): SessionTreeEntry[] {
  return parseJsonlSession(readFileSync(sessionFilePath, "utf-8")).filter(
    (entry): entry is SessionTreeEntry => entry.type !== "session",
  );
}

function getHiddenIds(entries: readonly SessionTreeEntry[]): string[] {
  return entries.filter((entry) => entry.hidden === true).map((entry) => entry.id);
}

function createInteractiveModeInstance(
  InteractiveMode: { prototype: StubInteractiveMode },
  state: RuntimeState,
): StubInteractiveMode {
  const instance = Object.create(InteractiveMode.prototype) as StubInteractiveMode;
  Object.defineProperty(instance, "sessionManager", {
    configurable: true,
    value: {
      getCwd: () => state.cwd,
      getEntries: () => state.liveEntries,
      getLeafId: () => state.leafId,
    },
  });
  return instance;
}

function buildCommandContext(
  cwd: string,
  sessionFilePath: string,
  notifications: Notification[],
  state: RuntimeState,
  reloads: { count: number },
): CommandContextStub {
  return {
    cwd,
    hasUI: true,
    async reload(): Promise<void> {
      reloads.count += 1;
    },
    sessionManager: {
      getEntries: () => state.liveEntries,
      getLeafId: () => state.leafId,
      getSessionFile: () => sessionFilePath,
    },
    ui: {
      notify(message: string, level: NotificationLevel = "info"): void {
        notifications.push({ message, level });
      },
    },
  };
}

function assertLatestControlEntry(
  entries: readonly SessionTreeEntry[],
  expectedId: string,
  expectedData: HideMessagesControlEntryData,
): void {
  const control = entries[entries.length - 1] as SessionTreeEntry & {
    customType?: string;
    data?: HideMessagesControlEntryData;
  };
  assert.equal(control.id, expectedId);
  assert.equal(control.customType, HIDE_MESSAGES_CONTROL_CUSTOM_TYPE);
  assert.deepEqual(control.data, expectedData);
}

test("pi-transcript-window patches renderSessionEntries and filters hidden entries (pi 0.84+)", async () => {
  const tempRoot = createTempRoot("runtime-validation");
  const nodeModulesRoot = join(distRoot, "node_modules");
  const nodeModulesExisted = existsSync(nodeModulesRoot);
  const stubPackageRoot = join(nodeModulesRoot, "@mariozechner", "pi-coding-agent");
  installPiCodingAgentStub(stubPackageRoot);

  try {
    const { InteractiveMode } = await import("@earendil-works/pi-coding-agent");
    const { applyHideMessagesRenderPatch } = await import("../src/render-patch.js");
    const { default: hideMessagesExtension } = await import("../index.js");

    resetInteractiveModePrototype(InteractiveMode as never);

    // First patch applies cleanly; second is idempotent.
    assert.deepEqual(await applyHideMessagesRenderPatch(), { patched: true, alreadyPatched: false });
    assert.deepEqual(await applyHideMessagesRenderPatch(), { patched: false, alreadyPatched: true });

    resetInteractiveModePrototype(InteractiveMode as never);

    const sessionFilePath = join(tempRoot, "session.jsonl");
    writeFileSync(sessionFilePath, serializeJsonlSession(buildSessionEntries()), "utf-8");

    const projectConfigPath = join(tempRoot, ".pi", "extensions", "pi-transcript-window", "config.json");
    mkdirSync(join(tempRoot, ".pi", "extensions", "pi-transcript-window"), { recursive: true });
    writeFileSync(
      projectConfigPath,
      JSON.stringify(
        { debug: false, defaultVisibleCount: 2, autoHideOnSessionStart: true },
        null,
        2,
      ),
      "utf-8",
    );

    const notifications: Notification[] = [];
    const commands = new Map<string, RegisteredCommand>();
    const sessionStartHandlers: Array<(event: { type: string; reason: string }, ctx: CommandContextStub) => Promise<void> | void> = [];
    const reloads = { count: 0 };
    let controlSequence = 0;

    const state: RuntimeState = {
      cwd: tempRoot,
      leafId: "assistant-2",
      liveEntries: readTreeEntries(sessionFilePath),
    };

    const rebuildRuntimeStateFromFile = (): void => {
      state.liveEntries = readTreeEntries(sessionFilePath);
      state.leafId = state.liveEntries[state.liveEntries.length - 1]?.id ?? null;
    };

    const commandContext = buildCommandContext(tempRoot, sessionFilePath, notifications, state, reloads);

    const pi = {
      appendEntry<T = unknown>(customType: string, data?: T): void {
        controlSequence += 1;
        const entry = {
          type: "custom",
          id: `control-${controlSequence}`,
          parentId: state.leafId,
          timestamp: new Date(1_700_000_010_000 + controlSequence * 1_000).toISOString(),
          customType,
          data,
        } as SessionTreeEntry;

        state.liveEntries = [...state.liveEntries, entry];
        state.leafId = entry.id;

        const nextEntries = [...parseJsonlSession(readFileSync(sessionFilePath, "utf-8")), entry];
        writeFileSync(sessionFilePath, serializeJsonlSession(nextEntries), "utf-8");
      },
      on(
        eventName: string,
        handler: (event: { type: string; reason: string }, ctx: CommandContextStub) => Promise<void> | void,
      ): void {
        if (eventName === "session_start") {
          sessionStartHandlers.push(handler);
        }
      },
      registerCommand(name: string, definition: RegisteredCommand): void {
        commands.set(name, definition);
      },
    };

    hideMessagesExtension(pi as never);

    assert.ok(commands.has(HIDE_MESSAGES_COMMAND));
    assert.ok(commands.has(RESTORE_MESSAGES_COMMAND));

    const runSessionStart = async (reason: string): Promise<void> => {
      for (const handler of sessionStartHandlers) {
        await handler({ type: "session_start", reason }, commandContext);
      }
    };

    // Auto-hide on session start must not touch the session file or live entries.
    const sessionFileBeforeAutoHide = readFileSync(sessionFilePath, "utf-8");
    await runSessionStart("resume");
    assert.deepEqual(getHiddenIds(state.liveEntries), []);
    assert.deepEqual(getHiddenIds(readTreeEntries(sessionFilePath)), []);
    assert.equal(readFileSync(sessionFilePath, "utf-8"), sessionFileBeforeAutoHide);

    // Patched render: hidden entries are filtered out before reaching the original.
    const hiddenRenderInstance = createInteractiveModeInstance(
      InteractiveMode as new () => StubInteractiveMode,
      state,
    );
    hiddenRenderInstance.renderSessionEntries?.(state.liveEntries, { populateHistory: true, updateFooter: true });
    assert.deepEqual(
      hiddenRenderInstance.lastRender?.entries.map((entry) => entry.id),
      ["user-2", "assistant-2"],
    );

    // Restore: everything becomes visible again.
    await commands.get(RESTORE_MESSAGES_COMMAND)?.handler("", commandContext);
    assert.equal(reloads.count, 1);
    rebuildRuntimeStateFromFile();
    assertLatestControlEntry(
      state.liveEntries,
      "control-1",
      { mode: HIDE_MESSAGES_CONTROL_MODE_MANUAL_RESTORE },
    );

    const restoredRenderInstance = createInteractiveModeInstance(
      InteractiveMode as new () => StubInteractiveMode,
      state,
    );
    restoredRenderInstance.renderSessionEntries?.(state.liveEntries);
    assert.deepEqual(
      restoredRenderInstance.lastRender?.entries
        .filter((entry) => entry.type === "message")
        .map((entry) => entry.id),
      ["user-1", "assistant-1", "user-2", "assistant-2"],
    );

    // Manual hide with a count.
    await commands.get(HIDE_MESSAGES_COMMAND)?.handler("2", commandContext);
    assert.equal(reloads.count, 2);
    rebuildRuntimeStateFromFile();
    assertLatestControlEntry(
      state.liveEntries,
      "control-2",
      {
        mode: HIDE_MESSAGES_CONTROL_MODE_MANUAL_HIDE,
        visibleCount: 2,
        firstVisibleEntryId: "user-2",
      },
    );

    const manualHideRenderInstance = createInteractiveModeInstance(
      InteractiveMode as new () => StubInteractiveMode,
      state,
    );
    manualHideRenderInstance.renderSessionEntries?.(state.liveEntries);
    assert.deepEqual(
      manualHideRenderInstance.lastRender?.entries
        .filter((entry) => entry.type === "message")
        .map((entry) => entry.id),
      ["user-2", "assistant-2"],
    );

    assert.equal(
      notifications.some((entry) => entry.message.includes("failed to patch TUI message rendering")),
      false,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(stubPackageRoot, { recursive: true, force: true });
    if (!nodeModulesExisted) {
      rmSync(nodeModulesRoot, { recursive: true, force: true });
    }
  }
});
