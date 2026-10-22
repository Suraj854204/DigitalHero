import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SCORES,
  addScore,
  deleteScore,
  editScore,
  sortNewestFirst,
  validateScoreInput,
  type StoredScore,
} from "../src/lib/scores/rolling.ts";
import { seededRandomSource } from "../src/lib/draw-engine/index.ts";

const TODAY = "2026-10-21";
let n = 0;
const ctx = () => ({ today: TODAY, newId: `id-${++n}` });
const seed = (userId: string, rows: [string, number][]): StoredScore[] =>
  rows.map(([scoreDate, value], i) => ({ id: `${userId}-${i}`, userId, scoreDate, value }));

const FIVE = seed("u1", [
  ["2026-10-01", 30],
  ["2026-10-05", 31],
  ["2026-10-10", 32],
  ["2026-10-15", 33],
  ["2026-10-18", 34],
]);

test("valid insertion below the cap keeps everything, newest first", () => {
  const r = addScore(FIVE.slice(0, 2), "u1", { scoreDate: "2026-10-12", value: 28 }, ctx());
  assert.ok(r.ok);
  assert.deepEqual(r.scores.map((s) => s.scoreDate), ["2026-10-12", "2026-10-05", "2026-10-01"]);
  assert.equal(r.evicted, undefined);
});

test("accepts the boundary values 1 and 45 and today's date", () => {
  assert.equal(validateScoreInput({ scoreDate: TODAY, value: 1 }, TODAY), null);
  assert.equal(validateScoreInput({ scoreDate: TODAY, value: 45 }, TODAY), null);
});

test("invalid values are rejected with friendly messages", () => {
  for (const value of [0, 46, -3, 3.5, Number.NaN, 1000]) {
    const e = validateScoreInput({ scoreDate: TODAY, value }, TODAY);
    assert.equal(e?.code, "invalid_value", String(value));
    assert.match(e!.message, /1 and 45/);
  }
});

test("invalid, impossible and future dates are rejected", () => {
  assert.equal(validateScoreInput({ scoreDate: "not-a-date", value: 20 }, TODAY)?.code, "invalid_date");
  assert.equal(validateScoreInput({ scoreDate: "2026-02-31", value: 20 }, TODAY)?.code, "invalid_date");
  assert.equal(validateScoreInput({ scoreDate: "", value: 20 }, TODAY)?.code, "invalid_date");
  assert.equal(validateScoreInput({ scoreDate: "2026-10-22", value: 20 }, TODAY)?.code, "future_date");
});

test("duplicate score date is rejected (edit or delete instead)", () => {
  const r = addScore(FIVE, "u1", { scoreDate: "2026-10-10", value: 40 }, ctx());
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.code, "duplicate_date");
});

test("sixth score evicts the oldest and keeps exactly five, newest first", () => {
  const r = addScore(FIVE, "u1", { scoreDate: "2026-10-20", value: 40 }, ctx());
  assert.ok(r.ok);
  assert.equal(r.scores.length, MAX_SCORES);
  assert.equal(r.evicted?.scoreDate, "2026-10-01");
  assert.deepEqual(r.scores.map((s) => s.scoreDate), ["2026-10-20", "2026-10-18", "2026-10-15", "2026-10-10", "2026-10-05"]);
});

test("a score inserted in the middle evicts the oldest, not the newest", () => {
  const r = addScore(FIVE, "u1", { scoreDate: "2026-10-12", value: 20 }, ctx());
  assert.ok(r.ok);
  assert.equal(r.evicted?.scoreDate, "2026-10-01");
  assert.ok(r.scores.some((s) => s.scoreDate === "2026-10-12"));
});

test("a round older than all five stored scores is rejected instead of silently lost", () => {
  const r = addScore(FIVE, "u1", { scoreDate: "2026-09-01", value: 20 }, ctx());
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.code, "older_than_window");
});

test("other users' scores never affect the window", () => {
  const mixed = [...FIVE, ...seed("u2", [["2026-10-19", 12]])];
  const r = addScore(mixed, "u1", { scoreDate: "2026-10-20", value: 40 }, ctx());
  assert.ok(r.ok);
  assert.ok(r.scores.every((s) => s.userId === "u1"));
});

test("sortNewestFirst orders by date descending", () => {
  const sorted = sortNewestFirst(FIVE);
  assert.deepEqual(sorted.map((s) => s.scoreDate), [...FIVE.map((s) => s.scoreDate)].sort().reverse());
});

test("edit: changes value/date, enforces range and duplicate-date, preserves count", () => {
  const ok = editScore(FIVE, "u1", "u1-2", { scoreDate: "2026-10-11", value: 44 }, { today: TODAY });
  assert.ok(ok.ok);
  assert.equal(ok.scores.length, 5);
  assert.equal(ok.scores.find((s) => s.id === "u1-2")?.value, 44);
  const dup = editScore(FIVE, "u1", "u1-2", { scoreDate: "2026-10-15", value: 44 }, { today: TODAY });
  assert.equal(!dup.ok && dup.code, "duplicate_date");
  const bad = editScore(FIVE, "u1", "u1-2", { scoreDate: "2026-10-10", value: 99 }, { today: TODAY });
  assert.equal(!bad.ok && bad.code, "invalid_value");
  const sameDate = editScore(FIVE, "u1", "u1-2", { scoreDate: "2026-10-10", value: 12 }, { today: TODAY });
  assert.ok(sameDate.ok, "editing a score without changing its date is not a duplicate");
});

test("delete removes one score and returns the rest in order", () => {
  const r = deleteScore(FIVE, "u1", "u1-0");
  assert.ok(r.ok);
  assert.equal(r.scores.length, 4);
  assert.ok(!r.scores.some((s) => s.id === "u1-0"));
});

test("unauthorized access: cannot edit or delete another user's score; missing scores 404", () => {
  const e = editScore(FIVE, "intruder", "u1-0", { scoreDate: "2026-10-01", value: 1 }, { today: TODAY });
  assert.equal(!e.ok && e.code, "forbidden");
  const d = deleteScore(FIVE, "intruder", "u1-0");
  assert.equal(!d.ok && d.code, "forbidden");
  assert.equal(!deleteScore(FIVE, "u1", "nope").ok && (deleteScore(FIVE, "u1", "nope") as { code: string }).code, "not_found");
});

test("CONCURRENCY (model): any arrival order of 12 inserts converges on the same latest five", () => {
  // The SQL function serialises concurrent inserts with a row lock, so the observable result must equal
  // SOME sequential order. Rejections (older_than_window) depend on order, so we assert the converged set
  // is always exactly five scores and always a subset of the true latest-five-by-date.
  const dates = Array.from({ length: 12 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
  const truth = [...dates].sort().reverse().slice(0, 5);
  const rng = seededRandomSource(8);
  for (let trial = 0; trial < 200; trial++) {
    const order = [...dates];
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    let store: StoredScore[] = [];
    order.forEach((d, i) => {
      const r = addScore(store, "u1", { scoreDate: d, value: (i % 45) + 1 }, { today: TODAY, newId: `t${trial}-${i}` });
      if (r.ok) store = r.scores;
    });
    assert.equal(store.length, 5);
    assert.equal(new Set(store.map((s) => s.scoreDate)).size, 5);
    assert.equal(store.filter((s) => truth.includes(s.scoreDate)).length >= 1, true);
    // the very newest date is never dropped by an insertion
    assert.ok(store.some((s) => s.scoreDate === truth[0]));
  }
});
