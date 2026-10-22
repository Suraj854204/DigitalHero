import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TIER_CONFIG,
  LedgerError,
  MoneyError,
  allocatePrizes,
  percentOf,
  scheduleAnnualRecognition,
  seededRandomSource,
  splitAmongRecipients,
  splitEvenly,
  splitPayment,
  sum,
  validateLedger,
  type LedgerEntry,
  type MatchTier,
  type TierConfig,
} from "../src/lib/draw-engine/index.ts";

const none = { 5: [], 4: [], 3: [] } as Record<MatchTier, string[]>;
const alloc = (over: Partial<Parameters<typeof allocatePrizes>[0]> = {}) =>
  allocatePrizes({
    drawId: "d1",
    poolMinor: 1_000_000,
    jackpotCarryInMinor: 0,
    tierConfig: DEFAULT_TIER_CONFIG,
    winnersByTier: none,
    ...over,
  });

/* ------------------------------- money -------------------------------- */
test("money: percentOf is exact integer math; rejects floats and bad bps", () => {
  assert.equal(percentOf(100_000, 4000), 40_000);
  assert.equal(percentOf(999, 3333), 332); // floor(999*0.3333)
  assert.equal(percentOf(Number.MAX_SAFE_INTEGER, 5000), Math.floor(Number.MAX_SAFE_INTEGER / 2)); // BigInt, no overflow
  assert.throws(() => percentOf(10.5, 100), MoneyError);
  assert.throws(() => percentOf(-1, 100), MoneyError);
  assert.throws(() => percentOf(100, 10_001), MoneyError);
  assert.throws(() => percentOf(100, 33.3), MoneyError);
});

test("money: splitEvenly always sums to the total and gives remainder to the first shares", () => {
  assert.deepEqual(splitEvenly(10, 3), [4, 3, 3]);
  assert.deepEqual(splitEvenly(0, 4), [0, 0, 0, 0]);
  for (let total = 0; total < 200; total++) {
    for (let parts = 1; parts <= 13; parts++) {
      const shares = splitEvenly(total, parts);
      assert.equal(sum(shares), total);
      assert.ok(Math.max(...shares) - Math.min(...shares) <= 1);
    }
  }
  assert.throws(() => splitEvenly(10, 0), MoneyError);
});

test("money: splitAmongRecipients is deterministic, conserves value, and varies order by seed", () => {
  const ids = ["u1", "u2", "u3"];
  const a = splitAmongRecipients(100, ids, "draw-A");
  const b = splitAmongRecipients(100, ids, "draw-A");
  assert.deepEqual([...a], [...b]);
  assert.equal(sum([...a.values()]), 100);
  assert.deepEqual([...a.values()].sort(), [33, 33, 34]);
  // across many draws each user should sometimes get the extra unit (not always the same person)
  const extraWinners = new Set<string>();
  for (let i = 0; i < 40; i++) {
    for (const [id, amt] of splitAmongRecipients(100, ids, `draw-${i}`)) if (amt === 34) extraWinners.add(id);
  }
  assert.equal(extraWinners.size, 3);
  assert.throws(() => splitAmongRecipients(100, ["a", "a"], "x"), /duplicate/);
});

/* ------------------------------ allocation ----------------------------- */
test("allocation: default 40/35/25 on a round pool", () => {
  const r = alloc({ winnersByTier: { 5: ["a"], 4: ["b"], 3: ["c"] } });
  assert.equal(r.tiers[5].allocationMinor, 400_000);
  assert.equal(r.tiers[4].allocationMinor, 350_000);
  assert.equal(r.tiers[3].allocationMinor, 250_000);
  assert.deepEqual(r.payouts.map((p) => [p.userId, p.amountMinor]).sort(), [
    ["a", 400_000],
    ["b", 350_000],
    ["c", 250_000],
  ]);
});

test("allocation: rounding dust goes to the 5-match tier so the whole pool is assigned", () => {
  // 1_000_001 * 35% = 350_000.35 -> 350_000 ; * 25% = 250_000.25 -> 250_000 ; 40% = 400_000.4 -> 400_000
  const r = alloc({ poolMinor: 1_000_001, winnersByTier: { 5: ["a"], 4: ["b"], 3: ["c"] } });
  assert.equal(r.tiers[4].allocationMinor, 350_000);
  assert.equal(r.tiers[3].allocationMinor, 250_000);
  assert.equal(r.tiers[5].allocationMinor, 400_001); // 400_000 + 1 dust
  assert.equal(sum(r.payouts.map((p) => p.amountMinor)), 1_000_001);
});

test("allocation: equal split among multiple winners; indivisible remainder distributed, never lost", () => {
  const r = alloc({ poolMinor: 100_000, winnersByTier: { 5: [], 4: ["a", "b", "c"], 3: [] } });
  // tier 4 = 35_000 / 3 = 11_666 r2
  const amounts = r.payouts.filter((p) => p.tier === 4).map((p) => p.amountMinor).sort();
  assert.deepEqual(amounts, [11_666, 11_667, 11_667]);
  assert.equal(sum(amounts), 35_000);
});

test("allocation: a winner appears once per tier and total payouts equal funds actually claimed", () => {
  const r = alloc({ winnersByTier: { 5: ["a"], 4: ["b", "c"], 3: ["d", "e", "f"] } });
  const ids = r.payouts.map((p) => p.userId);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(sum(r.payouts.map((p) => p.amountMinor)) + r.jackpotCarryOutMinor + r.reserveMinor, 1_000_000);
});

test("allocation: no winners anywhere -> jackpot rolls over, lower tiers go to reserve, ledger balances", () => {
  const r = alloc({ poolMinor: 1_000_000 });
  assert.equal(r.payouts.length, 0);
  assert.equal(r.jackpotCarryOutMinor, 400_000);
  assert.equal(r.reserveMinor, 600_000);
  validateLedger(r.ledger, 1_000_000);
});

test("allocation: jackpot carry-in joins the 5-match fund, and is consumed when someone wins it", () => {
  const won = alloc({ jackpotCarryInMinor: 250_000, winnersByTier: { 5: ["a", "b"], 4: [], 3: [] } });
  assert.equal(won.tiers[5].fundMinor, 650_000);
  assert.deepEqual(won.payouts.map((p) => p.amountMinor), [325_000, 325_000]);
  assert.equal(won.jackpotCarryOutMinor, 0);
  validateLedger(won.ledger, 1_250_000);

  const rolled = alloc({ jackpotCarryInMinor: 250_000 });
  assert.equal(rolled.jackpotCarryOutMinor, 650_000); // 400_000 new + 250_000 carried in
});

test("allocation: jackpot rollover chains across draws without losing money", () => {
  let carry = 0;
  let totalIn = 0;
  for (let draw = 0; draw < 5; draw++) {
    const pool = 100_000 + draw * 777;
    totalIn += pool;
    const r = alloc({ drawId: `d${draw}`, poolMinor: pool, jackpotCarryInMinor: carry });
    carry = r.jackpotCarryOutMinor;
  }
  // five consecutive no-winner draws: carry == 40% of everything ever contributed (plus dust)
  assert.ok(carry >= percentOf(totalIn, 4000));
  assert.ok(carry <= percentOf(totalIn, 4000) + 5);
});

test("allocation: unclaimedPolicy 'jackpot' rolls lower tiers into the jackpot instead of the reserve", () => {
  const cfg: TierConfig = { ...DEFAULT_TIER_CONFIG, unclaimedPolicy: "jackpot" };
  const r = alloc({ tierConfig: cfg });
  assert.equal(r.jackpotCarryOutMinor, 1_000_000);
  assert.equal(r.reserveMinor, 0);
});

test("allocation: zero pool is valid and produces no ledger noise", () => {
  const r = alloc({ poolMinor: 0 });
  assert.equal(r.ledger.length, 0);
  assert.equal(r.jackpotCarryOutMinor, 0);
});

test("allocation: invalid config and non-integer money are rejected", () => {
  const bad: TierConfig = { ...DEFAULT_TIER_CONFIG, shareBps: { 5: 4000, 4: 3500, 3: 2000 } };
  assert.throws(() => alloc({ tierConfig: bad }), /sum to 10000/);
  assert.throws(() => alloc({ poolMinor: 100.5 }), MoneyError);
  assert.throws(() => alloc({ jackpotCarryInMinor: -1 }), MoneyError);
});

test("allocation: custom tier shares work and still conserve", () => {
  const cfg: TierConfig = { ...DEFAULT_TIER_CONFIG, shareBps: { 5: 5000, 4: 3000, 3: 2000 } };
  const r = alloc({ tierConfig: cfg, poolMinor: 333_333, winnersByTier: { 5: ["a"], 4: ["b"], 3: ["c", "d"] } });
  validateLedger(r.ledger, 333_333);
  assert.equal(sum(r.payouts.map((p) => p.amountMinor)), 333_333);
});

test("PROPERTY: ledger conserves money for 500 random pools, carry-ins and winner counts", () => {
  const rng = seededRandomSource(2026);
  for (let i = 0; i < 500; i++) {
    const pool = rng.int(50_000_000);
    const carry = rng.int(5_000_000);
    const counts = [rng.int(4), rng.int(6), rng.int(9)];
    let n = 0;
    const mk = (c: number) => Array.from({ length: c }, () => `u${n++}`);
    const r = alloc({
      drawId: `p${i}`,
      poolMinor: pool,
      jackpotCarryInMinor: carry,
      winnersByTier: { 5: mk(counts[0]), 4: mk(counts[1]), 3: mk(counts[2]) },
    });
    validateLedger(r.ledger, pool + carry);
    assert.equal(sum(r.payouts.map((p) => p.amountMinor)) + r.jackpotCarryOutMinor + r.reserveMinor, pool + carry);
    for (const t of [5, 4, 3] as const) {
      const tierPayouts = r.payouts.filter((p) => p.tier === t).map((p) => p.amountMinor);
      if (tierPayouts.length) assert.ok(Math.max(...tierPayouts) - Math.min(...tierPayouts) <= 1);
    }
  }
});

/* ------------------------- ledger validation --------------------------- */
const good = (): LedgerEntry[] => [
  { from: "pool:d", to: "tier:5", amountMinor: 100, kind: "tier_allocation" },
  { from: "tier:5", to: "winner:u1", amountMinor: 100, kind: "prize" },
];

test("ledger validator accepts a clean ledger", () => validateLedger(good(), 100));

test("ledger validator rejects tampering", () => {
  const unbalanced = good();
  unbalanced[1].amountMinor = 99; // 1 unit stays in tier:5
  assert.throws(() => validateLedger(unbalanced, 100), LedgerError);

  assert.throws(() => validateLedger(good(), 101), /funding/);
  assert.throws(() => validateLedger([{ ...good()[0], amountMinor: 0 }], 0), /invalid amount/);
  assert.throws(() => validateLedger([{ ...good()[0], amountMinor: 1.5 }], 1), /invalid amount/);
  assert.throws(() => validateLedger([{ from: "tier:5", to: "tier:5", amountMinor: 1, kind: "x" }], 0), /within/);
  const sinkDebited: LedgerEntry[] = [...good(), { from: "winner:u1", to: "winner:u2", amountMinor: 100, kind: "bad" }];
  assert.throws(() => validateLedger(sinkDebited, 100), /debited|retains/);
});

/* ------------------------ contributions / annual ----------------------- */
test("contribution split: charity floor 10%, pool configurable, platform is the remainder", () => {
  const s = splitPayment(99_900, { charityBps: 1000, poolBps: 5000 });
  assert.deepEqual(s, { amountMinor: 99_900, charityMinor: 9_990, poolMinor: 49_950, platformMinor: 39_960 });
  assert.equal(s.charityMinor + s.poolMinor + s.platformMinor, s.amountMinor);
});

test("contribution split: below the 10% minimum or over 100% in total is rejected", () => {
  assert.throws(() => splitPayment(1000, { charityBps: 999, poolBps: 0 }), /at least 10%/);
  assert.throws(() => splitPayment(1000, { charityBps: 6000, poolBps: 4001 }), /exceed 100%/);
  assert.throws(() => splitPayment(10.5, { charityBps: 1000, poolBps: 0 }), MoneyError);
});

test("annual policy: 12 monthly recognitions sum exactly to the payment, nothing counted twice", () => {
  const total = 999_999;
  const sched = scheduleAnnualRecognition(total, { charityBps: 1500, poolBps: 4000 });
  assert.equal(sched.length, 12);
  assert.equal(sum(sched.map((m) => m.split.amountMinor)), total);
  for (const m of sched) assert.equal(m.split.charityMinor + m.split.poolMinor + m.split.platformMinor, m.split.amountMinor);
  const charityTotal = sum(sched.map((m) => m.split.charityMinor));
  const platformTotal = sum(sched.map((m) => m.split.platformMinor));
  const poolTotal = sum(sched.map((m) => m.split.poolMinor));
  assert.equal(charityTotal + platformTotal + poolTotal, total);
});
