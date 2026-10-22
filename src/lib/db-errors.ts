/**
 * Postgres functions raise 'CODE: human message'. We surface the human message only for known
 * codes; anything else (constraint names, internals) becomes a generic message.
 */
const SAFE = new Set([
  "INVALID_VALUE", "INVALID_DATE", "FUTURE_DATE", "DUPLICATE_DATE", "OLDER_THAN_WINDOW", "NOT_FOUND", "INVALID_PERCENTAGE",
  "TRANSITION", "REASON_REQUIRED", "REFERENCE_REQUIRED", "PAYOUT_REFERENCE_CONFLICT", "INVALID_PATH", "DRAW_IN_FLIGHT",
  "CUTOFF_NOT_REACHED", "SNAPSHOT_MISMATCH", "RESULT_MISMATCH", "JACKPOT_CHANGED", "POOL_CHANGED", "INVALID_NUMBERS",
  "INVALID_CONFIG", "FORBIDDEN", "IMMUTABLE", "SCORE_CAP", "LEDGER", "UNAUTHENTICATED",
]);

export function friendlyDbError(message: string | undefined, fallback = "Something went wrong. Please try again."): string {
  if (!message) return fallback;
  const m = /^([A-Z_]+):\s*([\s\S]+)$/.exec(message.trim());
  if (m && SAFE.has(m[1])) return m[2].trim();
  return fallback;
}

export function dbErrorCode(message: string | undefined): string | null {
  return /^([A-Z_]+):/.exec(message?.trim() ?? "")?.[1] ?? null;
}
