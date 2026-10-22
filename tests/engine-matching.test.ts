import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SnapshotError,
  buildParticipants,
  countMatches,
  evaluateEligibility,
  freezeSnapshot,
  isSubscriptionActiveAt,
  matchParticipants,
  tierForMatches,
  type CandidateUser,
  type FrozenParticipant,
  type ScoreRecord,
} from "../src/lib/draw-engine/index.ts";

const WIN = [5, 12, 23, 34, 45];

const mkScores = (values: number[], startDay = 20): ScoreRecord[] =>
  values.map((value, i) => ({ id: `s${i}-${value}`, scoreDate: `2026-09-${String(startDay - i).padStart(2, "0")}`, value }));

const participant = (userId: string, values: number[]): FrozenParticipant => ({ userId, scores: mkScores(values) });

test("five-, four-, three-match counts and tiers", () => {
  assert.equal(countMatches(WIN, participant("a", [5, 12, 23, 34, 45])), 5);
  assert.equal(countMatches(WIN, participant("b", [5, 12, 23, 34, 1])), 4);
  assert.equal(countMatches(WIN, participant("c", [5, 12, 23, 2, 1])), 3);
  assert.equal(countMatches(WIN, participant("d", [5, 12, 3, 2, 1])), 2);
  assert.equal(tierForMatches(5), 5);
  assert.equal(tierForMatches(4), 4);
  assert.equal(tierForMatches(3), 3);
  assert.equal(tierForMatches(2), null);
  assert.equal(tierForMatches(0), null);
});

test("duplicate score values count once (set semantics)", () => {
  // Two 5s and three 12s still only match the two distinct winning numbers 5 and 12.
  assert.equal(countMatches(WIN, participant("dup", [5, 5, 12, 12, 12])), 2);
});

test("each participant is placed in exactly one tier", () => {
  const run = matchParticipants(WIN, [
    participant("a", [5, 12, 23, 34, 45]),
    participant("b", [5, 12, 23, 34, 1]),
    participant("c", [5, 12, 23, 2, 1]),
    participant("d", [9, 9, 9, 9, 9]),
  ]);
  assert.deepEqual(run.winnersByTier, { 5: ["a"], 4: ["b"], 3: ["c"] });
  assert.equal(run.outcomes.length, 4);
  const all = [...run.winnersByTier[5], ...run.winnersByTier[4], ...run.winnersByTier[3]];
  assert.equal(new Set(all).size, all.length);
});

test("duplicate participant entries are rejected, never double counted", () => {
  const p = participant("a", [5, 12, 23, 34, 45]);
  const run = matchParticipants(WIN, [p, p]);
  assert.deepEqual(run.winnersByTier[5], ["a"]);
  assert.equal(run.rejected.length, 1);
  assert.match(run.rejected[0].error, /duplicate/);
});

test("invalid or incomplete snapshots are reported, not silently dropped or crashed on", () => {
  const four: FrozenParticipant = { userId: "short", scores: mkScores([5, 12, 23, 34]) };
  const outOfRange: FrozenParticipant = { userId: "bad", scores: mkScores([5, 12, 23, 34, 46]) };
  const noId = { userId: "", scores: mkScores([1, 2, 3, 4, 5]) } as FrozenParticipant;
  const run = matchParticipants(WIN, [four, outOfRange, noId, participant("ok", [5, 12, 23, 34, 45])]);
  assert.equal(run.rejected.length, 3);
  assert.deepEqual(run.winnersByTier[5], ["ok"]);
  assert.throws(() => countMatches(WIN, four), SnapshotError);
});

test("matching rejects malformed winning numbers", () => {
  assert.throws(() => matchParticipants([1, 2, 3], []));
});

/* ----------------------------- eligibility ----------------------------- */
const CUTOFF = new Date("2026-09-30T23:59:59Z");
const activeSub = { status: "active", activeFrom: "2026-08-01T00:00:00Z", activeUntil: "2026-10-15T00:00:00Z" };

const candidate = (over: Partial<CandidateUser> = {}): CandidateUser => ({
  userId: "u1",
  subscription: activeSub,
  scores: mkScores([10, 11, 12, 13, 14]),
  ...over,
});

test("eligible: active subscription and five valid scores", () => {
  const r = evaluateEligibility(candidate(), CUTOFF);
  assert.equal(r.eligible, true);
  assert.equal(r.snapshot?.scores.length, 5);
});

test("ineligible reasons are explicit", () => {
  assert.equal(evaluateEligibility(candidate({ subscription: null }), CUTOFF).reason, "no_subscription");
  assert.equal(
    evaluateEligibility(candidate({ subscription: { ...activeSub, status: "lapsed" } }), CUTOFF).reason,
    "subscription_inactive",
  );
  assert.equal(
    evaluateEligibility(candidate({ subscription: { ...activeSub, status: "past_due" } }), CUTOFF).reason,
    "subscription_inactive",
  );
  assert.equal(evaluateEligibility(candidate({ scores: mkScores([1, 2, 3, 4]) }), CUTOFF).reason, "too_few_scores");
  assert.equal(
    evaluateEligibility(candidate({ scores: mkScores([1, 2, 3, 4, 99]) }), CUTOFF).reason,
    "invalid_scores",
  );
});

test("subscription window is evaluated at the cutoff, not now", () => {
  assert.equal(isSubscriptionActiveAt({ ...activeSub, activeFrom: "2026-10-05T00:00:00Z" }, CUTOFF), false); // started after
  assert.equal(isSubscriptionActiveAt({ ...activeSub, activeUntil: "2026-09-20T00:00:00Z" }, CUTOFF), false); // ended before
  assert.equal(isSubscriptionActiveAt({ ...activeSub, status: "canceling" }, CUTOFF), true); // keeps paid access
  assert.equal(isSubscriptionActiveAt({ ...activeSub, activeUntil: null }, CUTOFF), true);
  assert.equal(isSubscriptionActiveAt(null, CUTOFF), false);
});

test("scores dated after the cutoff are excluded; the five newest before it are used", () => {
  const scores: ScoreRecord[] = [
    { id: "late", scoreDate: "2026-10-02", value: 40 }, // after cutoff -> ignored
    ...mkScores([1, 2, 3, 4, 5, 6], 25), // six older scores; newest five kept
  ];
  const r = evaluateEligibility(candidate({ scores }), CUTOFF);
  assert.equal(r.eligible, true);
  assert.deepEqual(r.snapshot!.scores.map((s) => s.value), [1, 2, 3, 4, 5]);
});

test("buildParticipants de-duplicates users and sorts deterministically", () => {
  const { participants, ineligible } = buildParticipants(
    [candidate({ userId: "z" }), candidate({ userId: "a" }), candidate({ userId: "a" }), candidate({ userId: "m", subscription: null })],
    CUTOFF,
  );
  assert.deepEqual(participants.map((p) => p.userId), ["a", "z"]);
  assert.deepEqual(ineligible, [{ userId: "m", reason: "no_subscription" }]);
});

test("frozen snapshots cannot be mutated", () => {
  const frozen = freezeSnapshot([participant("a", [1, 2, 3, 4, 5])]);
  assert.throws(() => {
    (frozen[0].scores[0] as { value: number }).value = 45;
  }, TypeError);
  assert.throws(() => {
    (frozen as FrozenParticipant[]).push(participant("b", [1, 2, 3, 4, 5]));
  }, TypeError);
});
