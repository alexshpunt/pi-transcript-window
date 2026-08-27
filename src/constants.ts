export const EXTENSION_ID = "pi-transcript-window";
export const CONFIG_BASENAME = "config.json";
export const HIDE_MESSAGES_COMMAND = "hide-messages";
export const RESTORE_MESSAGES_COMMAND = "restore-messages";
export const WINDOW_COMMAND = "window";
export const WINDOW_USAGE = `/window [<count>|off]`;
export const WINDOW_DESCRIPTION =
  "Set how many latest messages stay visible, or disable the limit (showing all).";
export const HIDE_MESSAGES_CONTROL_CUSTOM_TYPE = "pi-transcript-window.control";
export const WINDOW_CONTROL_CUSTOM_TYPE = "pi-transcript-window.window";
export const HIDE_MESSAGES_CONTROL_MODE_MANUAL_HIDE = "manual-hide" as const;
export const HIDE_MESSAGES_CONTROL_MODE_MANUAL_RESTORE = "manual-restore" as const;
export const HIDE_MESSAGES_USAGE = `Usage: /${HIDE_MESSAGES_COMMAND} [visible-count]`;
export const HIDE_MESSAGES_DESCRIPTION =
  "Keep only the latest N TUI messages visible (older entries stay in the session file).";
export const RESTORE_MESSAGES_DESCRIPTION =
  "Restore previously hidden TUI messages for the current session.";
export const DEFAULT_CONFIG_FILE = {
  enabled: true,
  debug: false,
  defaultVisibleCount: 50,
  autoHideOnSessionStart: true,
} as const;
