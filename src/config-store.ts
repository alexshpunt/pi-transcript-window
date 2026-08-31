import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  CONFIG_BASENAME,
  DEFAULT_CONFIG_FILE,
  EXTENSION_ID,
} from "./constants.js";
import { resolvePiAgentDir } from "./agent-dir.js";
import { getErrorMessage } from "./shared/error-utils.js";
import { isRecord } from "./shared/record-utils.js";
import type {
  HideMessagesConfigFile,
  HideMessagesConfigLoadResult,
  HideMessagesConfigController,
  ResolvedHideMessagesConfig,
} from "./types.js";

function getGlobalConfigPath(): string {
  return join(resolvePiAgentDir(), "extensions", EXTENSION_ID, CONFIG_BASENAME);
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }

  if (value === undefined) {
    return "undefined";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function createWarning(path: string, reason: string, fallback: unknown): string {
  return `Invalid ${CONFIG_BASENAME} value '${path}': ${reason}. Using ${formatValue(fallback)}.`;
}

function getConfigCwd(ctx: Pick<ExtensionContext, "cwd">): string {
  return ctx.cwd || process.cwd();
}

function getProjectConfigPath(cwd: string): string {
  return join(cwd, ".pi", "extensions", EXTENSION_ID, CONFIG_BASENAME);
}

function readRawConfigRecord(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    return {};
  }

  const raw = readFileSync(filePath, "utf-8");
  if (!raw.trim()) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Expected a JSON object in '${filePath}'.`);
  }

  return parsed;
}

function readConfigFile(filePath: string, warnings: string[]): HideMessagesConfigFile {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const record = readRawConfigRecord(filePath);
    return {
      enabled: normalizeBoolean(record.enabled, "enabled", DEFAULT_CONFIG_FILE.enabled, warnings),
      debug: normalizeBoolean(record.debug, "debug", DEFAULT_CONFIG_FILE.debug, warnings),
      defaultVisibleCount: normalizeVisibleCount(record.defaultVisibleCount, warnings),
      autoHideOnSessionStart: normalizeBoolean(
        record.autoHideOnSessionStart,
        "autoHideOnSessionStart",
        DEFAULT_CONFIG_FILE.autoHideOnSessionStart,
        warnings,
      ),
    };
  } catch (error) {
    const message = getErrorMessage(error);
    warnings.push(`Failed to read '${filePath}': ${message}`);
    return {};
  }
}

function normalizeBoolean(
  value: unknown,
  path: string,
  fallback: boolean,
  warnings: string[],
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  warnings.push(createWarning(path, "expected a boolean", fallback));
  return undefined;
}

function normalizeVisibleCount(value: unknown, warnings: string[]): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || (value as number) < 1) {
    warnings.push(
      createWarning(
        "defaultVisibleCount",
        "expected a positive integer",
        DEFAULT_CONFIG_FILE.defaultVisibleCount,
      ),
    );
    return undefined;
  }

  return value as number;
}

function mergeConfigFile(
  base: ResolvedHideMessagesConfig,
  override: HideMessagesConfigFile,
): ResolvedHideMessagesConfig {
  return {
    ...base,
    enabled: override.enabled ?? base.enabled,
    debug: override.debug ?? base.debug,
    defaultVisibleCount: override.defaultVisibleCount ?? base.defaultVisibleCount,
    autoHideOnSessionStart: override.autoHideOnSessionStart ?? base.autoHideOnSessionStart,
  };
}

export function loadHideMessagesConfig(
  ctx: Pick<ExtensionContext, "cwd">,
): HideMessagesConfigLoadResult {
  const cwd = getConfigCwd(ctx);
  const projectConfigPath = getProjectConfigPath(cwd);
  const globalConfigPath = getGlobalConfigPath();
  const warnings: string[] = [];

  const globalConfig = readConfigFile(globalConfigPath, warnings);
  const projectConfig = readConfigFile(projectConfigPath, warnings);

  let config: ResolvedHideMessagesConfig = {
    configPath: projectConfigPath,
    enabled: DEFAULT_CONFIG_FILE.enabled,
    debug: DEFAULT_CONFIG_FILE.debug,
    defaultVisibleCount: DEFAULT_CONFIG_FILE.defaultVisibleCount,
    autoHideOnSessionStart: DEFAULT_CONFIG_FILE.autoHideOnSessionStart,
  };

  config = mergeConfigFile(config, globalConfig);
  config = mergeConfigFile(config, projectConfig);
  config.configPath = existsSync(projectConfigPath) ? projectConfigPath : globalConfigPath;

  return { config, warnings, projectConfigPath, globalConfigPath };
}

export function isHideMessagesEnabled(): boolean {
  const configPath = getGlobalConfigPath();
  // readConfigFile normalizes read/parse failures through getErrorMessage into
  // `warnings`. They are not surfaced here: loadHideMessagesConfig re-reads the
  // config at session start and reports the current warnings via the UI.
  const warnings: string[] = [];
  const file = readConfigFile(configPath, warnings);
  return file.enabled ?? DEFAULT_CONFIG_FILE.enabled;
}

/**
 * Persist a new defaultVisibleCount into the global config file so a
 * /hide-messages N tuning survives across sessions. Best-effort: on any
 * failure the in-memory value is updated but the file stays untouched.
 */
export function persistDefaultVisibleCount(count: number): boolean {
  const configPath = getGlobalConfigPath();
  try {
    const record = readRawConfigRecord(configPath);
    record.defaultVisibleCount = count;
    writeFileSync(configPath, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Update the cached in-memory config with a new defaultVisibleCount. The
 * command layer calls this after persisting to the file so subsequent renders
 * see the new value immediately without waiting for a reload.
 */
export function updateCachedDefaultVisibleCount(
  controller: HideMessagesConfigController,
  ctx: Pick<ExtensionContext, "cwd">,
  count: number,
): void {
  const cwd = getConfigCwd(ctx);
  const result = controller.getConfigResult({ cwd });
  const next: ResolvedHideMessagesConfig = {
    ...result.config,
    defaultVisibleCount: count,
  };
  controller.setConfigResult({ cwd }, { ...result, config: next });
}
