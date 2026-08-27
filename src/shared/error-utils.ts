/**
 * Shared error-normalization utilities for pi-transcript-window.
 *
 * Centralizes the `unknown` error-to-message extraction previously
 * inlined as `error instanceof Error ? error.message : String(error)`
 * across command, config-store, reload-queue, render-patch, and
 * restore-command modules.
 */

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
