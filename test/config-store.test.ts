import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXTENSION_ID,
} from "../src/constants.js";
import {
  loadHideMessagesConfig,
  persistDefaultVisibleCount,
} from "../src/config-store.js";

const distRoot = fileURLToPath(new URL("..", import.meta.url));

function createTempRoot(label: string): string {
  const root = join(
    distRoot,
    ".test-tmp",
    `${label}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  return root;
}

test("persistDefaultVisibleCount creates the config directory when missing (npm/git/-e installs)", () => {
  const root = createTempRoot("config-store");
  try {
    // Parent directory intentionally does not exist.
    const configPath = join(root, "does", "not", "exist", EXTENSION_ID, "config.json");
    assert.equal(existsSync(join(root, "does")), false);

    assert.equal(persistDefaultVisibleCount(configPath, 20), true);
    assert.equal(existsSync(configPath), true);

    const record = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    assert.deepEqual(record, { defaultVisibleCount: 20 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persistDefaultVisibleCount preserves other config keys", () => {
  const root = createTempRoot("config-store");
  try {
    const configPath = join(root, EXTENSION_ID, "config.json");
    mkdirSync(join(root, EXTENSION_ID), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ debug: false, defaultVisibleCount: 10, autoHideOnSessionStart: true }, null, 2),
      "utf-8",
    );

    assert.equal(persistDefaultVisibleCount(configPath, 25), true);
    const record = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    assert.deepEqual(record, {
      debug: false,
      defaultVisibleCount: 25,
      autoHideOnSessionStart: true,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persisted default survives a full config reload via the global agent dir", () => {
  const root = createTempRoot("config-store");
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.PI_CODING_AGENT_DIR = root;

    const cwd = join(root, "project");
    mkdirSync(cwd, { recursive: true });

    const before = loadHideMessagesConfig({ cwd });
    assert.equal(before.config.defaultVisibleCount, 10);
    assert.equal(before.config.configPath, join(root, "extensions", EXTENSION_ID, "config.json"));

    // The global config dir does not exist yet; the write must still succeed.
    assert.equal(
      persistDefaultVisibleCount(join(root, "extensions", EXTENSION_ID, "config.json"), 30),
      true,
    );

    const after = loadHideMessagesConfig({ cwd });
    assert.equal(after.config.defaultVisibleCount, 30);
  } finally {
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("project config still overrides the global default", () => {
  const root = createTempRoot("config-store");
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.PI_CODING_AGENT_DIR = root;

    const cwd = join(root, "project");
    const projectConfigPath = join(cwd, ".pi", "extensions", EXTENSION_ID, "config.json");
    mkdirSync(join(cwd, ".pi", "extensions", EXTENSION_ID), { recursive: true });
    writeFileSync(projectConfigPath, JSON.stringify({ defaultVisibleCount: 7 }), "utf-8");

    assert.equal(
      persistDefaultVisibleCount(join(root, "extensions", EXTENSION_ID, "config.json"), 30),
      true,
    );

    const result = loadHideMessagesConfig({ cwd });
    assert.equal(result.config.defaultVisibleCount, 7);
    assert.equal(result.config.configPath, projectConfigPath);
  } finally {
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
