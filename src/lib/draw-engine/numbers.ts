/**
 * Winning-number selection.
 *
 * RANDOM MODE
 *   Partial Fisher-Yates shuffle over 1..45 using an unbiased `RandomSource.int`.
 *   Every 5-subset is equally likely (given an unbiased source).
 *
 * WEIGHTED MODE (documented, deliberately simple, and NOT claimed "fair")
 *   1. Count how many times each value 1..45 appears across the frozen
 *      participant snapshots (`frequencyFromScores`).
 *   2. weight(n) = frequency(n) + smoothing            (bias = "frequent")
 *      weight(n) = (maxFreq - frequency(n)) + smoothing (bias = "rare")
 *      `smoothing` is a non-negative integer (default 1) so that numbers nobody
 *      has scored still have a chance and the draw cannot be fully predicted
 *      from the data alone.
 *   3. Sample 5 numbers WITHOUT replacement: for each pick draw an integer in
 *      [0, totalWeight) and walk the cumulative integer weights. Integer weights
 *      keep the sampling exact and free of floating-point drift.
 *   4. If fewer than 5 numbers have positive weight (possible only with
 *      smoothing = 0), the remaining picks are filled uniformly from the unused
 *      numbers and `fallbackFilled` reports how many. The loop is bounded: it
 *      runs exactly 5 iterations and can never spin forever.
 *
 *   This favours commonly-scored numbers (or rare ones) but makes no statistical
 *   fairness or security claim. Use the crypto source in production.
 */
import type { RandomSource } from "./rng.ts";
import { NUMBER_MAX, NUMBER_MIN, NUMBERS_PER_DRAW, type ScoreRecord, type WeightBias } from "./types.ts";

export class DrawNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrawNumberError";
  }
}

export function validateWinningNumbers(numbers: readonly number[]): void {
  if (numbers.length !== NUMBERS_PER_DRAW) {
    throw new DrawNumberError(`expected ${NUMBERS_PER_DRAW} numbers, got ${numbers.length}`);
  }
  const seen = new Set<number>();
  for (const n of numbers) {
    if (!Number.isInteger(n) || n < NUMBER_MIN || n > NUMBER_MAX) {
      throw new DrawNumberError(`number ${n} outside ${NUMBER_MIN}-${NUMBER_MAX}`);
    }
    if (seen.has(n)) throw new DrawNumberError(`duplicate number ${n}`);
    seen.add(n);
  }
}

export function drawRandomNumbers(rng: RandomSource): number[] {
  const pool = Array.from({ length: NUMBER_MAX - NUMBER_MIN + 1 }, (_, i) => i + NUMBER_MIN);
  const picked: number[] = [];
  for (let i = 0; i < NUMBERS_PER_DRAW; i++) {
    const j = i + rng.int(pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
    picked.push(pool[i]);
  }
  const sorted = picked.sort((a, b) => a - b);
  validateWinningNumbers(sorted);
  return sorted;
}

/** frequency[n] for n in 1..45 (index 0 unused). Invalid values are ignored, not trusted. */
export function frequencyFromScores(scores: Iterable<Pick<ScoreRecord, "value">>): number[] {
  const freq = new Array<number>(NUMBER_MAX + 1).fill(0);
  for (const s of scores) {
    if (Number.isInteger(s.value) && s.value >= NUMBER_MIN && s.value <= NUMBER_MAX) {
      freq[s.value] += 1;
    }
  }
  return freq;
}

export interface WeightedOptions {
  bias?: WeightBias;
  smoothing?: number;
}

export interface WeightedResult {
  numbers: number[];
  /** Effective integer weights used (index 0 unused), recorded for the audit trail. */
  weights: number[];
  fallbackFilled: number;
}

export function computeWeights(frequency: readonly number[], opts: WeightedOptions = {}): number[] {
  const bias = opts.bias ?? "frequent";
  const smoothing = opts.smoothing ?? 1;
  if (!Number.isInteger(smoothing) || smoothing < 0) {
    throw new DrawNumberError(`smoothing must be a non-negative integer, got ${smoothing}`);
  }
  if (frequency.length !== NUMBER_MAX + 1) {
    throw new DrawNumberError(`frequency table must have ${NUMBER_MAX + 1} entries`);
  }
  let maxFreq = 0;
  for (let n = NUMBER_MIN; n <= NUMBER_MAX; n++) {
    const f = frequency[n];
    if (!Number.isInteger(f) || f < 0) throw new DrawNumberError(`invalid frequency for ${n}: ${f}`);
    if (f > maxFreq) maxFreq = f;
  }
  const weights = new Array<number>(NUMBER_MAX + 1).fill(0);
  for (let n = NUMBER_MIN; n <= NUMBER_MAX; n++) {
    weights[n] = (bias === "rare" ? maxFreq - frequency[n] : frequency[n]) + smoothing;
  }
  return weights;
}

export function drawWeightedNumbers(
  frequency: readonly number[],
  rng: RandomSource,
  opts: WeightedOptions = {},
): WeightedResult {
  const weights = computeWeights(frequency, opts);
  const remaining = new Set<number>();
  for (let n = NUMBER_MIN; n <= NUMBER_MAX; n++) remaining.add(n);
  const picked: number[] = [];
  let fallbackFilled = 0;

  for (let pick = 0; pick < NUMBERS_PER_DRAW; pick++) {
    let total = 0;
    for (const n of remaining) total += weights[n];

    let chosen: number | undefined;
    if (total > 0) {
      let target = rng.int(total);
      for (const n of remaining) {
        if (target < weights[n]) {
          chosen = n;
          break;
        }
        target -= weights[n];
      }
    } else {
      // No positive weight left: uniform fill from what remains (bounded, no retry loop).
      const list = Array.from(remaining);
      chosen = list[rng.int(list.length)];
      fallbackFilled += 1;
    }
    if (chosen === undefined) throw new DrawNumberError("weighted sampling failed to choose a number");
    remaining.delete(chosen);
    picked.push(chosen);
  }
  const sorted = picked.sort((a, b) => a - b);
  validateWinningNumbers(sorted);
  return { numbers: sorted, weights, fallbackFilled };
}
