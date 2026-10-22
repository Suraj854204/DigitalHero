import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DrawNumberError,
  computeWeights,
  cryptoRandomSource,
  drawRandomNumbers,
  drawWeightedNumbers,
  frequencyFromScores,
  scriptedRandomSource,
  seededRandomSource,
  validateWinningNumbers,
} from "../src/lib/draw-engine/index.ts";

const zeroFreq = () => new Array<number>(46).fill(0);

test("random: always five distinct numbers within 1-45 (2,000 seeded draws)", () => {
  for (let seed = 1; seed <= 2000; seed++) {
    const nums = drawRandomNumbers(seededRandomSource(seed));
    assert.equal(nums.length, 5);
    assert.equal(new Set(nums).size, 5);
    for (const n of nums) assert.ok(Number.isInteger(n) && n >= 1 && n <= 45);
    assert.deepEqual(nums, [...nums].sort((a, b) => a - b));
  }
});

test("random: crypto source also yields valid draws", () => {
  for (let i = 0; i < 200; i++) validateWinningNumbers(drawRandomNumbers(cryptoRandomSource));
});

test("random: scripted source gives exact, hand-verified results", () => {
  // all-zero script walks the Fisher-Yates pool in order: 1,2,3,4,5
  assert.deepEqual(drawRandomNumbers(scriptedRandomSource([0, 0, 0, 0, 0])), [1, 2, 3, 4, 5]);
  // maximum picks: 45, then the displaced 1, 2, 3, 4
  assert.deepEqual(drawRandomNumbers(scriptedRandomSource([44, 43, 42, 41, 40])), [1, 2, 3, 4, 45]);
});

test("random: same seed reproduces, different seeds diverge", () => {
  assert.deepEqual(drawRandomNumbers(seededRandomSource(7)), drawRandomNumbers(seededRandomSource(7)));
  const distinct = new Set(Array.from({ length: 50 }, (_, s) => drawRandomNumbers(seededRandomSource(s)).join(",")));
  assert.ok(distinct.size > 40);
});

test("random: roughly uniform across 1-45 (sanity bound, not a proof of fairness)", () => {
  const counts = new Array(46).fill(0);
  const draws = 20000;
  const rng = seededRandomSource(12345);
  for (let i = 0; i < draws; i++) for (const n of drawRandomNumbers(rng)) counts[n]++;
  const expected = (draws * 5) / 45; // ~2222
  for (let n = 1; n <= 45; n++) assert.ok(Math.abs(counts[n] - expected) < expected * 0.1, `number ${n}: ${counts[n]}`);
});

test("random source rejects invalid ranges and exhausted scripts", () => {
  assert.throws(() => seededRandomSource(1).int(0), RangeError);
  assert.throws(() => scriptedRandomSource([5]).int(3), RangeError);
  assert.throws(() => scriptedRandomSource([]).int(3), /exhausted/);
});

test("validateWinningNumbers rejects wrong count, duplicates and out-of-range", () => {
  assert.throws(() => validateWinningNumbers([1, 2, 3, 4]), DrawNumberError);
  assert.throws(() => validateWinningNumbers([1, 2, 3, 4, 4]), /duplicate/);
  assert.throws(() => validateWinningNumbers([0, 2, 3, 4, 5]), /outside/);
  assert.throws(() => validateWinningNumbers([1, 2, 3, 4, 46]), /outside/);
  assert.throws(() => validateWinningNumbers([1, 2, 3, 4, 5.5]), /outside/);
  validateWinningNumbers([1, 2, 3, 4, 45]);
});

test("weighted: frequencies ignore invalid score values rather than trusting them", () => {
  const f = frequencyFromScores([{ value: 10 }, { value: 10 }, { value: 0 }, { value: 46 }, { value: 2.5 }, { value: 45 }]);
  assert.equal(f[10], 2);
  assert.equal(f[45], 1);
  assert.equal(f.reduce((a, b) => a + b, 0), 3);
});

test("weighted: weights = frequency + smoothing; rare bias inverts", () => {
  const f = zeroFreq();
  f[10] = 5;
  f[20] = 2;
  const frequent = computeWeights(f);
  assert.equal(frequent[10], 6);
  assert.equal(frequent[20], 3);
  assert.equal(frequent[1], 1);
  const rare = computeWeights(f, { bias: "rare" });
  assert.equal(rare[10], 1); // max freq -> lowest weight
  assert.equal(rare[1], 6); // never scored -> highest weight
});

test("weighted: deterministic pick from scripted source (cumulative walk)", () => {
  const f = zeroFreq();
  f[10] = 5; // weights: 1..9 -> 1 each, 10 -> 6, 11..45 -> 1 each; total 50
  // target 9 lands exactly on number 10's range [9..14]
  const r = drawWeightedNumbers(f, scriptedRandomSource([9, 0, 0, 0, 0]));
  assert.ok(r.numbers.includes(10));
  assert.equal(r.fallbackFilled, 0);
  // target 0 picks number 1
  const r2 = drawWeightedNumbers(f, scriptedRandomSource([0, 0, 0, 0, 0]));
  assert.deepEqual(r2.numbers, [1, 2, 3, 4, 5]);
});

test("weighted: zero-frequency numbers with smoothing 0 are never chosen while weighted ones remain, then uniform fallback fills", () => {
  const f = zeroFreq();
  f[7] = 3;
  f[9] = 1;
  const r = drawWeightedNumbers(f, scriptedRandomSource([0, 0, 0, 0, 0]), { smoothing: 0 });
  assert.ok(r.numbers.includes(7) && r.numbers.includes(9));
  assert.equal(r.fallbackFilled, 3);
  assert.equal(new Set(r.numbers).size, 5);
});

test("weighted: all-zero frequencies with smoothing 0 terminates via uniform fallback (no infinite loop)", () => {
  const r = drawWeightedNumbers(zeroFreq(), seededRandomSource(3), { smoothing: 0 });
  assert.equal(r.fallbackFilled, 5);
  validateWinningNumbers(r.numbers);
});

test("weighted: missing numbers (never scored) can still win with default smoothing", () => {
  const f = zeroFreq();
  f[1] = 100; // one dominant number
  let sawUnscored = false;
  for (let seed = 1; seed < 300 && !sawUnscored; seed++) {
    const r = drawWeightedNumbers(f, seededRandomSource(seed));
    if (r.numbers.some((n) => n !== 1)) sawUnscored = true;
    validateWinningNumbers(r.numbers);
  }
  assert.ok(sawUnscored);
});

test("weighted: heavily scored numbers appear more often than unscored (directional check only)", () => {
  const f = zeroFreq();
  for (let n = 1; n <= 5; n++) f[n] = 50;
  const rng = seededRandomSource(99);
  let hot = 0;
  let cold = 0;
  for (let i = 0; i < 3000; i++) {
    for (const n of drawWeightedNumbers(f, rng).numbers) n <= 5 ? hot++ : cold++;
  }
  // 5 hot numbers hold ~255/(255+40) of weight; expect hot share well above uniform (5/45 = 11%)
  assert.ok(hot / (hot + cold) > 0.3);
});

test("weighted: invalid inputs are rejected", () => {
  assert.throws(() => computeWeights(zeroFreq(), { smoothing: -1 }), DrawNumberError);
  assert.throws(() => computeWeights(zeroFreq(), { smoothing: 1.5 }), DrawNumberError);
  assert.throws(() => computeWeights([1, 2, 3]), /entries/);
  const bad = zeroFreq();
  bad[3] = -1;
  assert.throws(() => computeWeights(bad), /invalid frequency/);
});

test("weighted: the audit record carries the effective weights", () => {
  const f = zeroFreq();
  f[44] = 4;
  const r = drawWeightedNumbers(f, seededRandomSource(1));
  assert.equal(r.weights[44], 5);
  assert.equal(r.weights.length, 46);
});
