/**
 * Shared type-guard utilities for pi-hide-messages.
 *
 * Centralizes record-validation helpers previously duplicated across
 * config-store, session-control, and session-visibility modules.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
