/**
 * Extracts a human-readable message from a caught value, without assuming
 * it's a real `Error` instance. Supabase's PostgrestError does extend
 * `Error`, but not everything thrown across a native bridge does (e.g. an
 * aborted-fetch DOMException) — checking for a `message` string structurally
 * catches those too, so callers don't silently fall back to a generic
 * message when a specific, actionable one was available.
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}
