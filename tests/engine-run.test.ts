import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryDrawStore,
  TransitionError,
  assertDrawTransition,
  canTransitionDraw,
  computeDrawResult,
  hashSnapshot,
  publishDraw,
  scriptedRandomSource,
  seededRandomSource,
  simulateDraw,
  sum,
  validateLedger,
  type DrawConfig,
  type DrawStatus,
  type FrozenParticipant,
} from "../src/lib/draw-engine/index.ts";

const sc = (values: number[]) =>
  values.map((value, i) => ({ id: `s${i}`, scoreDate: `2026-09-${String(20 - i).padStart(2, "0")}`, value }));
const P = (userId: string, values: number[]): FrozenParticipant => ({ userId, scores: sc(values) });

// With scripted [0,0,0,0,0] the winning numbers are exactly 1,2,3,4,5.
const WIN_1_5 = () => scriptedRandomSource([0, 0, 0, 0, 0]);
const PARTICIPANTS = [
  P("jackpot", [1, 2, 3, 4, 5]),
  P("four-a", [1, 2, 3, 4, 40]),
  P("four-b", [1, 2, 3, 4, 41]),
  P("three", [1, 2, 3, 30, 31]),
  P("none", [30, 31, 32, 33, 34]),
];
const CONFIG: DrawConfig = { drawId: "draw-1", mode: "random", poolMinor: 1_000_000, jackpotCarryInMinor: 100_000 };

test("computeDrawResult: end-to-end numbers, tiers, prizes and a balanced ledger", () => {
  const r = computeDrawResult(CONFIG, PARTICIPANTS, WIN_1_5());
  assert.deepEqual(r.winningNumbers, [1, 2, 3, 4, 5]);
  assert.deepEqual(r.matches.winnersByTier, { 5: ["jackpot"], 4: ["four-a", "four-b"], 3: ["three"] });
  const byUser = Object.fromEntries(r.prizes.payouts.map((p) => [p.userId, p.amountMinor]));
  assert.equal(byUser.jackpot, 500_000); // 400_000 + 100_000 carry-in
  assert.equal(byUser["four-a"] + byUser["four-b"], 350_000);
  assert.equal(byUser.three, 250_000);
  assert.equal(r.prizes.jackpotCarryOutMinor, 0);
  validateLedger(r.prizes.ledger, 1_100_000);
  assert.equal(r.participantCount, 5);
  assert.equal(r.randomSource, "scripted");
});

test("computeDrawResult: deterministic - same seed and inputs give the same hash", () => {
  const a = computeDrawResult(CONFIG, PARTICIPANTS, seededRandomSource(5));
  const b = computeDrawResult(CONFIG, PARTICIPANTS, seededRandomSource(5));
  assert.equal(a.resultHash, b.resultHash);
  const c = computeDrawResult(CONFIG, PARTICIPANTS, seededRandomSource(6));
  assert.notEqual(a.resultHash, c.resultHash);
});

test("computeDrawResult: weighted mode records weights for the audit trail", () => {
  const r = computeDrawResult({ ...CONFIG, mode: "weighted" }, PARTICIPANTS, seededRandomSource(1));
  assert.equal(r.mode, "weighted");
  assert.ok(r.weights && r.weights.length === 46);
  assert.equal(r.weights[1], 5); // number 1 appears in four snapshots (+1 smoothing)
  assert.equal(new Set(r.winningNumbers).size, 5);
});

test("computeDrawResult: malformed snapshots are reported and excluded, prizes still conserve", () => {
  const broken: FrozenParticipant = { userId: "broken", scores: sc([1, 2, 3, 4]) };
  const r = computeDrawResult(CONFIG, [...PARTICIPANTS, broken], WIN_1_5());
  assert.equal(r.matches.rejected.length, 1);
  assert.equal(r.matches.rejected[0].userId, "broken");
  assert.equal(sum(r.prizes.payouts.map((p) => p.amountMinor)) + r.prizes.jackpotCarryOutMinor + r.prizes.reserveMinor, 1_100_000);
});

test("no participants at all: draw still valid, everything rolls/reserves", () => {
  const r = computeDrawResult(CONFIG, [], seededRandomSource(1));
  assert.equal(r.prizes.payouts.length, 0);
  assert.equal(r.prizes.jackpotCarryOutMinor, 500_000);
  assert.equal(r.prizes.reserveMinor, 600_000);
});

/* ------------------------------ simulation ----------------------------- */
test("simulation never mutates a store: no ledger, payouts, jackpot or status change", () => {
  const store = new InMemoryDrawStore();
  store.addDraw("draw-1", "simulated", PARTICIPANTS);
  const sim = simulateDraw(CONFIG, PARTICIPANTS, WIN_1_5());
  assert.equal(sim.simulated, true);
  assert.equal(store.ledger.length, 0);
  assert.equal(store.payouts.length, 0);
  assert.equal(store.jackpotLedger.length, 0);
  assert.equal(store.getStatus("draw-1"), "simulated");
  assert.equal(store.getResult("draw-1"), undefined);
});

test("simulation does not alter the published draw", () => {
  const store = new InMemoryDrawStore();
  store.addDraw("draw-1", "approved", PARTICIPANTS);
  const published = publishDraw(store, CONFIG, WIN_1_5());
  const ledgerBefore = JSON.stringify(store.ledger);
  simulateDraw(CONFIG, PARTICIPANTS, seededRandomSource(99));
  simulateDraw({ ...CONFIG, mode: "weighted" }, PARTICIPANTS, seededRandomSource(98));
  assert.equal(JSON.stringify(store.ledger), ledgerBefore);
  assert.equal(store.getResult("draw-1")?.resultHash, published.result.resultHash);
});

/* ----------------------------- state machine --------------------------- */
test("draw state machine: legal and illegal transitions", () => {
  const legal: [DrawStatus, DrawStatus][] = [
    ["draft", "simulated"],
    ["simulated", "simulated"],
    ["simulated", "approved"],
    ["approved", "published"],
    ["approved", "simulated"],
    ["draft", "cancelled"],
  ];
  for (const [a, b] of legal) assert.equal(canTransitionDraw(a, b), true, `${a}->${b}`);
  const illegal: [DrawStatus, DrawStatus][] = [
    ["draft", "published"],
    ["draft", "approved"],
    ["simulated", "published"],
    ["published", "approved"],
    ["published", "draft"],
    ["published", "published"],
    ["published", "cancelled"],
    ["cancelled", "draft"],
  ];
  for (const [a, b] of illegal) assert.equal(canTransitionDraw(a, b), false, `${a}->${b}`);
  assert.throws(() => assertDrawTransition("draft", "published"), TransitionError);
});

/* ------------------------------ publication ---------------------------- */
test("publish: only an approved draw can be published", () => {
  for (const status of ["draft", "simulated", "cancelled"] as DrawStatus[]) {
    const store = new InMemoryDrawStore();
    store.addDraw("draw-1", status, PARTICIPANTS);
    assert.throws(() => publishDraw(store, CONFIG, WIN_1_5()), TransitionError, status);
    assert.equal(store.ledger.length, 0);
  }
  assert.throws(() => publishDraw(new InMemoryDrawStore(), CONFIG, WIN_1_5()), /not found/);
});

test("publish: succeeds once, writes ledger, payouts and jackpot delta exactly once", () => {
  const store = new InMemoryDrawStore();
  store.addDraw("draw-1", "approved", PARTICIPANTS);
  const out = publishDraw(store, CONFIG, WIN_1_5());
  assert.equal(out.outcome, "published");
  assert.equal(store.getStatus("draw-1"), "published");
  assert.equal(store.ledger.length, 1);
  assert.equal(store.payouts.length, 4);
  assert.deepEqual(store.jackpotLedger, [{ drawId: "draw-1", deltaMinor: -100_000 }]); // carry-in consumed, jackpot won
});

test("publish: duplicate publication is rejected idempotently - no new numbers, no new money", () => {
  const store = new InMemoryDrawStore();
  store.addDraw("draw-1", "approved", PARTICIPANTS);
  const first = publishDraw(store, CONFIG, WIN_1_5());
  const second = publishDraw(store, CONFIG, seededRandomSource(777)); // a different rng must not matter
  assert.equal(second.outcome, "already_published");
  assert.deepEqual(second.result.winningNumbers, first.result.winningNumbers);
  assert.equal(second.result.resultHash, first.result.resultHash);
  assert.equal(store.ledger.length, 1);
  assert.equal(store.payouts.length, 4);
  assert.equal(store.jackpotLedger.length, 1);
});

test("publish: concurrent publish attempts produce exactly one publication", async () => {
  const store = new InMemoryDrawStore();
  store.addDraw("draw-1", "approved", PARTICIPANTS);
  const results = await Promise.all(
    Array.from({ length: 25 }, (_, i) => Promise.resolve().then(() => publishDraw(store, CONFIG, seededRandomSource(i)))),
  );
  assert.equal(results.filter((r) => r.outcome === "published").length, 1);
  assert.equal(results.filter((r) => r.outcome === "already_published").length, 24);
  assert.equal(store.ledger.length, 1);
  assert.equal(new Set(results.map((r) => r.result.resultHash)).size, 1);
});

test("publish: a snapshot altered after approval is detected and publication refused", () => {
  const store = new InMemoryDrawStore();
  store.addDraw("draw-1", "approved", PARTICIPANTS);
  store.tamperSnapshot("draw-1", [...PARTICIPANTS.slice(0, 4), P("none", [1, 2, 3, 4, 5])]);
  assert.throws(() => publishDraw(store, CONFIG, WIN_1_5()), /snapshot hash mismatch/);
  assert.equal(store.getStatus("draw-1"), "approved");
  assert.equal(store.ledger.length, 0);
});

test("publish: an approved draw without a snapshot cannot be published", () => {
  const store = new InMemoryDrawStore();
  store.addDraw("draw-1", "approved");
  assert.throws(() => publishDraw(store, CONFIG, WIN_1_5()), /no frozen snapshot/);
});

test("repeated execution: re-running compute with the frozen snapshot is stable", () => {
  const hash = hashSnapshot(PARTICIPANTS);
  for (let i = 0; i < 20; i++) assert.equal(computeDrawResult(CONFIG, PARTICIPANTS, WIN_1_5()).snapshotHash, hash);
  // hash is order independent
  assert.equal(hashSnapshot([...PARTICIPANTS].reverse()), hash);
});

test("jackpot ledger reflects rollover when nobody wins the jackpot", () => {
  const store = new InMemoryDrawStore();
  const noJackpot = PARTICIPANTS.filter((p) => p.userId !== "jackpot");
  store.addDraw("draw-2", "approved", noJackpot);
  const out = publishDraw(store, { ...CONFIG, drawId: "draw-2" }, WIN_1_5());
  assert.equal(out.result.prizes.jackpotCarryOutMinor, 500_000);
  assert.deepEqual(store.jackpotLedger, [{ drawId: "draw-2", deltaMinor: 400_000 }]); // +500_000 out, -100_000 in
});
