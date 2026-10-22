/**
 * Injectable random sources.
 *
 * Production draws MUST use `cryptoRandomSource` (Node's CSPRNG, `crypto.randomInt`,
 * which is unbiased via rejection sampling). The seeded and scripted sources are
 * for deterministic tests and reproducible simulations ONLY; a seeded PRNG is
 * predictable and must not decide a published draw.
 */
import { randomInt } from "node:crypto";

export interface RandomSource {
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  readonly kind: "crypto" | "seeded" | "scripted";
}

function assertMax(maxExclusive: number): void {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1) {
    throw new RangeError(`maxExclusive must be a positive safe integer, got ${maxExclusive}`);
  }
}

export const cryptoRandomSource: RandomSource = {
  kind: "crypto",
  int(maxExclusive) {
    assertMax(maxExclusive);
    if (maxExclusive === 1) return 0;
    return randomInt(maxExclusive);
  },
};

/** mulberry32 core: returns a function producing uint32 values. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  };
}

/** Deterministic PRNG with rejection sampling so results are unbiased. TEST/SIMULATION USE. */
export function seededRandomSource(seed: number): RandomSource {
  const next = mulberry32(seed);
  return {
    kind: "seeded",
    int(maxExclusive) {
      assertMax(maxExclusive);
      if (maxExclusive === 1) return 0;
      const range = 0x1_0000_0000;
      const limit = range - (range % maxExclusive);
      let v = next();
      while (v >= limit) v = next();
      return v % maxExclusive;
    },
  };
}

/**
 * Scripted source: returns the supplied values in order (each must be a valid
 * result for the requested range). Throws when exhausted or out of range, so a
 * test can never silently pass on garbage.
 */
export function scriptedRandomSource(values: readonly number[]): RandomSource {
  let i = 0;
  return {
    kind: "scripted",
    int(maxExclusive) {
      assertMax(maxExclusive);
      if (i >= values.length) throw new Error("scripted random source exhausted");
      const v = values[i++];
      if (!Number.isInteger(v) || v < 0 || v >= maxExclusive) {
        throw new RangeError(`scripted value ${v} out of range [0, ${maxExclusive})`);
      }
      return v;
    },
  };
}
