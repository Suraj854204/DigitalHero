
/**
 * Eligibility and snapshot building.
 *
 * A user is eligible for a draw iff, at the eligibility cutoff:
 * 1. Their paid subscription is active.
 * 2. They have five valid scores dated on or before the cutoff date.
 *
 * Subscription access uses the interval [activeFrom, activeUntil).
 * A canceling subscription remains active until its paid period ends.
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

const ACTIVE_STATUSES = new Set(["active", "canceling"]);

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

export interface EligibilitySummary {
  participants: FrozenParticipant[];
  ineligible: {
    userId: string;
    reason: IneligibleReason;
  }[];
}

/**
 * Returns true when paid subscription access is valid at the cutoff.
 *
 * activeFrom is inclusive.
 * activeUntil is exclusive.
 */
export function isSubscriptionActiveAt(
  sub: SubscriptionPeriod | null,
  cutoff: Date,
): boolean {
  if (!sub || !ACTIVE_STATUSES.has(sub.status)) {
    return false;
  }

  const cutoffTime = cutoff.getTime();

  if (!Number.isFinite(cutoffTime)) {
    return false;
  }

  const activeFrom = Date.parse(sub.activeFrom);

  if (!Number.isFinite(activeFrom) || activeFrom > cutoffTime) {
    return false;
  }

  // A null end date means no recorded end date.
  if (sub.activeUntil === null) {
    return true;
  }

  const activeUntil = Date.parse(sub.activeUntil);

  if (!Number.isFinite(activeUntil)) {
    return false;
  }

  return cutoffTime < activeUntil;
}

/**
 * Validates a golf score and its ISO calendar date.
 */
export function isValidScore(s: ScoreRecord): boolean {
  if (
    !Number.isInteger(s.value) ||
    s.value < NUMBER_MIN ||
    s.value > NUMBER_MAX ||
    !ISO_DATE.test(s.scoreDate)
  ) {
    return false;
  }

  const parsedDate = new Date(`${s.scoreDate}T00:00:00.000Z`);

  // Reject impossible dates such as 2026-02-30.
  return (
    Number.isFinite(parsedDate.getTime()) &&
    parsedDate.toISOString().slice(0, 10) === s.scoreDate
  );
}

/**
 * Sort scores newest first.
 * Score dates should be unique per user.
 */
export function sortScoresNewestFirst(
  scores: readonly ScoreRecord[],
): ScoreRecord[] {
  return [...scores].sort((a, b) => {
    if (a.scoreDate !== b.scoreDate) {
      return a.scoreDate < b.scoreDate ? 1 : -1;
    }

    if (a.id === b.id) {
      return 0;
    }

    return a.id < b.id ? -1 : 1;
  });
}

/**
 * Evaluates one candidate against the draw cutoff.
 */
export function evaluateEligibility(
  user: CandidateUser,
  cutoff: Date,
): EligibilityResult {
  if (!user.subscription) {
    return {
      userId: user.userId,
      eligible: false,
      reason: "no_subscription",
    };
  }

  if (!isSubscriptionActiveAt(user.subscription, cutoff)) {
    return {
      userId: user.userId,
      eligible: false,
      reason: "subscription_inactive",
    };
  }

  const cutoffTime = cutoff.getTime();

  if (!Number.isFinite(cutoffTime)) {
    return {
      userId: user.userId,
      eligible: false,
      reason: "invalid_scores",
    };
  }

  const cutoffDate = cutoff.toISOString().slice(0, 10);

  // Consider only scores recorded on or before the cutoff date.
  const inScope = user.scores.filter(
    (score) =>
      ISO_DATE.test(score.scoreDate) &&
      score.scoreDate <= cutoffDate,
  );

  const latest = sortScoresNewestFirst(inScope).slice(
    0,
    SCORES_REQUIRED,
  );

  if (latest.length < SCORES_REQUIRED) {
    return {
      userId: user.userId,
      eligible: false,
      reason: "too_few_scores",
    };
  }

  const allValid = latest.every(isValidScore);

  const uniqueDates =
    new Set(latest.map((score) => score.scoreDate)).size ===
    latest.length;

  if (!allValid || !uniqueDates) {
    return {
      userId: user.userId,
      eligible: false,
      reason: "invalid_scores",
    };
  }

  return {
    userId: user.userId,
    eligible: true,
    snapshot: {
      userId: user.userId,
      scores: latest,
    },
  };
}

/**
 * Builds a unique, deterministic list of eligible participants.
 */
export function buildParticipants(
  users: readonly CandidateUser[],
  cutoff: Date,
): EligibilitySummary {
  const participants: FrozenParticipant[] = [];

  const ineligible: EligibilitySummary["ineligible"] = [];

  const seen = new Set<string>();

  for (const user of users) {
    if (seen.has(user.userId)) {
      continue;
    }

    seen.add(user.userId);

    const result = evaluateEligibility(user, cutoff);

    if (result.eligible && result.snapshot) {
      participants.push(result.snapshot);
    } else {
      ineligible.push({
        userId: user.userId,
        reason: result.reason!,
      });
    }
  }

  participants.sort((a, b) =>
    a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0,
  );

  return {
    participants,
    ineligible,
  };
}

/**
 * Deep-freezes participant snapshots so they cannot be modified
 * after the draw snapshot has been captured.
 */
export function freezeSnapshot(
  participants: readonly FrozenParticipant[],
): readonly FrozenParticipant[] {
  return Object.freeze(
    participants.map((participant) =>
      Object.freeze({
        userId: participant.userId,
        scores: Object.freeze(
          participant.scores.map((score) =>
            Object.freeze({ ...score }),
          ),
        ),
      }),
    ),
  );
}
