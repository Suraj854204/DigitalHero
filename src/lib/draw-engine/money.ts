/**
 * Integer minor-unit money helpers (paise / cents).
 *
 * RULE: no floating point is ever used for money. Percentages are expressed
 * in basis points (bps): 1% = 100 bps, 100% = 10_000 bps. All intermediate
 * products use BigInt so large pools cannot overflow Number.MAX_SAFE_INTEGER.
 */

export const BPS_DENOMINATOR = 10_000;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function assertMinor(value: number, label = "amount"): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a safe integer in minor units, got ${value}`);
  }
  if (value < 0) {
    throw new MoneyError(`${label} must not be negative, got ${value}`);
  }
}

export function assertBps(value: number, label = "bps"): void {
  if (!Number.isInteger(value) || value < 0 || value > BPS_DENOMINATOR) {
    throw new MoneyError(`${label} must be an integer between 0 and ${BPS_DENOMINATOR}, got ${value}`);
  }
}

/** floor(amount * bps / 10_000) using exact integer arithmetic. */
export function percentOf(amountMinor: number, bps: number): number {
  assertMinor(amountMinor);
  assertBps(bps);
  return Number((BigInt(amountMinor) * BigInt(bps)) / BigInt(BPS_DENOMINATOR));
}

/**
 * Split `totalMinor` into `parts` integer shares that sum EXACTLY to total.
 * The first `total % parts` shares receive one extra minor unit.
 * (Callers decide the order of recipients; see `splitAmongRecipients`.)
 */
export function splitEvenly(totalMinor: number, parts: number): number[] {
  assertMinor(totalMinor, "total");
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new MoneyError(`parts must be a positive integer, got ${parts}`);
  }
  const base = Math.floor(totalMinor / parts);
  const remainder = totalMinor - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** FNV-1a 32-bit hash. Deterministic ordering key, NOT a security primitive. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Split an amount equally between recipients. Indivisible remainder units are
 * handed out one each to recipients in an order derived from hashing
 * `${seed}:${id}`. That order is deterministic (reproducible for audit) yet not
 * biased towards any alphabetical id, and differs between draws because the
 * seed (the draw id) differs.
 */
export function splitAmongRecipients(
  totalMinor: number,
  recipientIds: readonly string[],
  seed: string,
): Map<string, number> {
  const unique = Array.from(new Set(recipientIds));
  if (unique.length !== recipientIds.length) {
    throw new MoneyError("duplicate recipient ids in split");
  }
  const result = new Map<string, number>();
  if (unique.length === 0) return result;
  const ordered = [...unique].sort((a, b) => {
    const ha = fnv1a(`${seed}:${a}`);
    const hb = fnv1a(`${seed}:${b}`);
    return ha !== hb ? ha - hb : a < b ? -1 : 1;
  });
  const shares = splitEvenly(totalMinor, ordered.length);
  ordered.forEach((id, i) => result.set(id, shares[i]));
  return result;
}

export function sum(values: readonly number[]): number {
  let total = 0n;
  for (const v of values) total += BigInt(v);
  const out = Number(total);
  if (!Number.isSafeInteger(out)) throw new MoneyError("sum exceeds safe integer range");
  return out;
}
