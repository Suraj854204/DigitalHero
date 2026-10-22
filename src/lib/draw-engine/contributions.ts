/**
 * Splitting a subscription payment into charity / prize pool / platform parts,
 * and the annual-plan recognition policy.
 *
 * POLICY (documented in docs/DECISIONS.md):
 *  - MONTHLY payment: split at payment time; the three portions are recognised
 *    immediately and posted to the financial ledger once (idempotent on the
 *    Stripe invoice id).
 *  - ANNUAL payment: the full amount is first booked to `deferred_revenue`.
 *    Each month, 1/12 (integer split, remainder to the earliest months) is
 *    recognised and THEN split into charity / pool / platform. Charity and pool
 *    portions are never recorded at payment time for annual plans, so the same
 *    money cannot be counted twice. The charity total for an annual plan is the
 *    sum of its monthly recognised portions.
 */
import { BPS_DENOMINATOR, MoneyError, assertBps, assertMinor, percentOf, splitEvenly } from "./money.ts";

export const MIN_CHARITY_BPS = 1000; // PRD §08.1: minimum 10% of subscription fee

export interface SplitConfig {
  charityBps: number;
  poolBps: number;
  minCharityBps?: number;
}

export interface PaymentSplit {
  amountMinor: number;
  charityMinor: number;
  poolMinor: number;
  platformMinor: number;
}

export function validateSplitConfig(cfg: SplitConfig): void {
  assertBps(cfg.charityBps, "charityBps");
  assertBps(cfg.poolBps, "poolBps");
  const min = cfg.minCharityBps ?? MIN_CHARITY_BPS;
  if (cfg.charityBps < min) {
    throw new MoneyError(`charity contribution must be at least ${min / 100}% (got ${cfg.charityBps / 100}%)`);
  }
  if (cfg.charityBps + cfg.poolBps > BPS_DENOMINATOR) {
    throw new MoneyError("charity + prize pool shares exceed 100% of the payment");
  }
}

export function splitPayment(amountMinor: number, cfg: SplitConfig): PaymentSplit {
  assertMinor(amountMinor, "payment");
  validateSplitConfig(cfg);
  const charityMinor = percentOf(amountMinor, cfg.charityBps);
  const poolMinor = percentOf(amountMinor, cfg.poolBps);
  return { amountMinor, charityMinor, poolMinor, platformMinor: amountMinor - charityMinor - poolMinor };
}

export interface RecognitionMonth {
  /** 0-based month offset from the start of the annual term. */
  monthIndex: number;
  split: PaymentSplit;
}

export function scheduleAnnualRecognition(totalMinor: number, cfg: SplitConfig, months = 12): RecognitionMonth[] {
  assertMinor(totalMinor, "annual payment");
  validateSplitConfig(cfg);
  return splitEvenly(totalMinor, months).map((amount, monthIndex) => ({
    monthIndex,
    split: splitPayment(amount, cfg),
  }));
}
