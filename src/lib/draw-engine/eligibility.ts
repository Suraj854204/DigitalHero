/**
 * Eligibility and snapshot building.
 *
 * A user is eligible for a draw iff, AT THE ELIGIBILITY CUTOFF:
 *   1. their paid access was active (see `isSubscriptionActiveAt`), and
 *   2. they have exactly five valid scores whose play date is on/before the
 *      cutoff date (the five most recent such scores are used).
 *
 * Ineligible users are returned with a machine-readable reason so the admin UI
 * and the subscriber's "why am I not eligible" view share one source of truth.
 */
import {
  NUMBER_MAX,
  NUMBER_MIN,
  SCORES_REQUIRED,
  type CandidateUser,
  type FrozenParticipant,
  type ScoreRecord,
  type SubscriptionPeriod,
} from "./types.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type IneligibleReason =
  | "no_subscription"
  | "subscription_inactive"
  | "too_few_scores"
  | "invalid_scores";

export interface EligibilityResult {
  userId: string;
  eligible: boolean;
  reason?: IneligibleReason;
  snapshot?: FrozenParticipant;
}

const ACTIVE_STATUSES = new Set(["active", "canceling"]);

/**
 * Paid access is active at `cutoff` when the status grants access and the
 * cutoff falls inside [activeFrom, activeUntil). A "canceling" subscription
 * keeps access until the end of the paid period.
 */
export function isSubscriptionActiveAt(sub: SubscriptionPeriod | null, cutoff: Date): boolean {
  if (!sub || !ACTIVE_STATUSES.has(sub.status)) return false;
  const from = Date.parse(sub.activeFrom);
  if (Number.isNaN(from) || from > cutoff.getTime()) return false;
  if (sub.activeUntil === null) return true;
  const until = Date.parse(sub.activeUntil);
  return !Number.isNaN(until) && until > cutoff.getTime();
}

export function isValidScore(s: ScoreRecord): boolean {
  return (
    Number.isInteger(s.value) &&
    s.value >= NUMBER_MIN &&
    s.value <= NUMBER_MAX &&
    ISO_DATE.test(s.scoreDate) &&
    !Number.isNaN(Date.parse(`${s.scoreDate}T00:00:00Z`))
  );
}

/** Newest first by play date; ties are impossible per user (unique date) but id breaks them deterministically. */
export function sortScoresNewestFirst(scores: readonly ScoreRecord[]): ScoreRecord[] {
  return [...scores].sort((a, b) =>
    a.scoreDate === b.scoreDate ? (a.id < b.id ? -1 : 1) : a.scoreDate < b.scoreDate ? 1 : -1,
  );
}

export function evaluateEligibility(user: CandidateUser, cutoff: Date): EligibilityResult {
  if (!user.subscription) return { userId: user.userId, eligible: false, reason: "no_subscription" };
  if (!isSubscriptionActiveAt(user.subscription, cutoff)) {
    return { userId: user.userId, eligible: false, reason: "subscription_inactive" };
  }
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const inScope = user.scores.filter((s) => ISO_DATE.test(s.scoreDate) && s.scoreDate <= cutoffDate);
  const latest = sortScoresNewestFirst(inScope).slice(0, SCORES_REQUIRED);
  if (latest.length < SCORES_REQUIRED) {
    return { userId: user.userId, eligible: false, reason: "too_few_scores" };
  }
  if (!latest.every(isValidScore) || new Set(latest.map((s) => s.scoreDate)).size !== latest.length) {
    return { userId: user.userId, eligible: false, reason: "invalid_scores" };
  }
  return { userId: user.userId, eligible: true, snapshot: { userId: user.userId, scores: latest } };
}

export interface EligibilitySummary {
  participants: FrozenParticipant[];
  ineligible: { userId: string; reason: IneligibleReason }[];
}

export function buildParticipants(users: readonly CandidateUser[], cutoff: Date): EligibilitySummary {
  const participants: FrozenParticipant[] = [];
  const ineligible: EligibilitySummary["ineligible"] = [];
  const seen = new Set<string>();
  for (const u of users) {
    if (seen.has(u.userId)) continue; // a user can never be counted twice
    seen.add(u.userId);
    const r = evaluateEligibility(u, cutoff);
    if (r.eligible && r.snapshot) participants.push(r.snapshot);
    else ineligible.push({ userId: u.userId, reason: r.reason! });
  }
  participants.sort((a, b) => (a.userId < b.userId ? -1 : 1));
  return { participants, ineligible };
}

/**
 * Deep-freeze participants so engine code (and tests) cannot mutate a snapshot
 * after it has been captured. The database enforces the same rule with triggers.
 */
export function freezeSnapshot(participants: readonly FrozenParticipant[]): readonly FrozenParticipant[] {
  return Object.freeze(
    participants.map((p) =>
      Object.freeze({ userId: p.userId, scores: Object.freeze(p.scores.map((s) => Object.freeze({ ...s }))) }),
    ),
  );
}
