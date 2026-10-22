/**
 * Rolling-five score rules (pure reference implementation).
 *
 * The AUTHORITATIVE, concurrency-safe implementation is the SQL function
 * `public.add_score` (row lock on the user's profile + unique index on
 * (user_id, score_date)). This module mirrors those rules exactly so they can be
 * unit-tested without a database, and so server actions can give friendly,
 * identical error messages before they reach SQL.
 *
 * Rules (PRD §05):
 *  - value is an integer in 1..45; every score has a date
 *  - one score per date per user
 *  - at most 5 retained, shown newest first (by play date)
 *  - adding a 6th evicts the OLDEST (by play date)
 * Decision (docs/DECISIONS.md #D4): a new score whose date is older than all five
 *  stored scores is REJECTED rather than inserted-then-instantly-evicted, which
 *  would silently lose the user's entry.
 */
export const SCORE_MIN = 1;
export const SCORE_MAX = 45;
export const MAX_SCORES = 5;

export interface StoredScore {
  id: string;
  userId: string;
  scoreDate: string; // YYYY-MM-DD
  value: number;
}

export interface ScoreInput {
  scoreDate: string;
  value: number;
}

export type ScoreErrorCode =
  | "invalid_value"
  | "invalid_date"
  | "future_date"
  | "duplicate_date"
  | "older_than_window"
  | "not_found"
  | "forbidden";

export interface ScoreError {
  ok: false;
  code: ScoreErrorCode;
  message: string;
}

export type ScoreResult = { ok: true; scores: StoredScore[]; evicted?: StoredScore } | ScoreError;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const fail = (code: ScoreErrorCode, message: string): ScoreError => ({ ok: false, code, message });

export function sortNewestFirst<T extends { scoreDate: string; id: string }>(scores: readonly T[]): T[] {
  return [...scores].sort((a, b) =>
    a.scoreDate === b.scoreDate ? (a.id < b.id ? -1 : 1) : a.scoreDate < b.scoreDate ? 1 : -1,
  );
}

export function validateScoreInput(input: ScoreInput, today: string): ScoreError | null {
  if (!Number.isInteger(input.value) || input.value < SCORE_MIN || input.value > SCORE_MAX) {
    return fail("invalid_value", `Enter a whole number between ${SCORE_MIN} and ${SCORE_MAX}.`);
  }
  if (!ISO.test(input.scoreDate) || Number.isNaN(Date.parse(`${input.scoreDate}T00:00:00Z`))) {
    return fail("invalid_date", "Enter a valid date.");
  }
  // Round-trip guards against 2026-02-31 style rollovers.
  if (new Date(`${input.scoreDate}T00:00:00Z`).toISOString().slice(0, 10) !== input.scoreDate) {
    return fail("invalid_date", "Enter a valid date.");
  }
  if (input.scoreDate > today) {
    return fail("future_date", "Scores can't be dated in the future.");
  }
  return null;
}

export function addScore(
  existing: readonly StoredScore[],
  userId: string,
  input: ScoreInput,
  ctx: { today: string; newId: string },
): ScoreResult {
  const invalid = validateScoreInput(input, ctx.today);
  if (invalid) return invalid;
  const mine = existing.filter((s) => s.userId === userId);
  if (mine.some((s) => s.scoreDate === input.scoreDate)) {
    return fail("duplicate_date", "You already have a score for that date. Edit or delete it instead.");
  }
  const sorted = sortNewestFirst(mine);
  if (sorted.length >= MAX_SCORES && input.scoreDate < sorted[sorted.length - 1].scoreDate) {
    return fail(
      "older_than_window",
      "That round is older than your five most recent scores, so it can't be added.",
    );
  }
  const next = sortNewestFirst([...mine, { id: ctx.newId, userId, scoreDate: input.scoreDate, value: input.value }]);
  const kept = next.slice(0, MAX_SCORES);
  const evicted = next.length > MAX_SCORES ? next[MAX_SCORES] : undefined;
  return { ok: true, scores: kept, evicted };
}

export function editScore(
  existing: readonly StoredScore[],
  actorId: string,
  scoreId: string,
  input: ScoreInput,
  ctx: { today: string },
): ScoreResult {
  const target = existing.find((s) => s.id === scoreId);
  if (!target) return fail("not_found", "Score not found.");
  if (target.userId !== actorId) return fail("forbidden", "You can only change your own scores.");
  const invalid = validateScoreInput(input, ctx.today);
  if (invalid) return invalid;
  const mine = existing.filter((s) => s.userId === actorId);
  if (mine.some((s) => s.id !== scoreId && s.scoreDate === input.scoreDate)) {
    return fail("duplicate_date", "You already have a score for that date.");
  }
  const updated = mine.map((s) => (s.id === scoreId ? { ...s, scoreDate: input.scoreDate, value: input.value } : s));
  return { ok: true, scores: sortNewestFirst(updated) };
}

export function deleteScore(existing: readonly StoredScore[], actorId: string, scoreId: string): ScoreResult {
  const target = existing.find((s) => s.id === scoreId);
  if (!target) return fail("not_found", "Score not found.");
  if (target.userId !== actorId) return fail("forbidden", "You can only change your own scores.");
  return { ok: true, scores: sortNewestFirst(existing.filter((s) => s.userId === actorId && s.id !== scoreId)) };
}
