export interface SessionHeaderEntry {
  type: "session";
  [key: string]: unknown;
}

export interface SessionTreeEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  hidden?: boolean;
  [key: string]: unknown;
}

export interface SessionMessageEntry extends SessionTreeEntryBase {
  type: "message";
  message: { role?: string; [key: string]: unknown };
}

export interface SessionCustomMessageEntry extends SessionTreeEntryBase {
  type: "custom_message";
  customType: string;
  content: unknown;
  display: boolean;
  details?: unknown;
}

export interface SessionBranchSummaryEntry extends SessionTreeEntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
}

export interface SessionCompactionEntry extends SessionTreeEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
}

export type SessionTreeEntry =
  | SessionMessageEntry
  | SessionCustomMessageEntry
  | SessionBranchSummaryEntry
  | SessionCompactionEntry
  | SessionTreeEntryBase;

export type SessionFileEntry = SessionHeaderEntry | SessionTreeEntry;

export interface HideMessagesConfigFile {
  enabled?: boolean;
  debug?: boolean;
  defaultVisibleCount?: number;
  autoHideOnSessionStart?: boolean;
}

export interface ResolvedHideMessagesConfig {
  configPath: string;
  enabled: boolean;
  debug: boolean;
  defaultVisibleCount: number;
  autoHideOnSessionStart: boolean;
}

export interface HideMessagesConfigLoadResult {
  config: ResolvedHideMessagesConfig;
  warnings: string[];
  projectConfigPath: string;
  globalConfigPath: string;
}

export interface HideMessagesPlan {
  entries: SessionFileEntry[];
  changed: boolean;
  hiddenEntryCount: number;
  visibleItemCount: number;
  retainedVisibleItemCount: number;
  firstVisibleEntryId?: string;
}

export type HideMessagesControlMode = "manual-hide" | "manual-restore";

export interface HideMessagesControlEntryData {
  mode: HideMessagesControlMode;
  visibleCount?: number;
  firstVisibleEntryId?: string;
}

export interface RestoreMessagesPlan {
  changed: boolean;
  restoredEntryCount: number;
}

export interface HideMessagesConfigController {
  getConfigResult(ctx: { cwd: string }): HideMessagesConfigLoadResult;
  setConfigResult(
    ctx: { cwd: string },
    result: HideMessagesConfigLoadResult,
  ): void;
  reportWarnings(
    ctx: {
      hasUI: boolean;
      ui: { notify(message: string, level?: "info" | "warning" | "error"): void };
    },
    configResult: HideMessagesConfigLoadResult,
  ): void;
}
