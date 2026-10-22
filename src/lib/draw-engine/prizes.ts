/**
 * Prize-pool allocation. Integer minor units only.
 *
 * RULES
 *  1. tierAllocation(t) = floor(pool * shareBps(t) / 10_000).
 *     Rounding dust (pool - sum of allocations) is added to the 5-match tier so
 *     the whole pool is always assigned. shareBps must sum to exactly 10_000.
 *  2. The 5-match tier is additionally funded by the jackpot carried in from
 *     earlier draws.
 *  3. A tier with winners splits its fund equally; indivisible units go one each
 *     to winners in a seeded-hash order (see `splitAmongRecipients`).
 *  4. A tier with NO winners:
 *       - rollover[t] === true  -> its fund is carried out to the next draw's jackpot
 *       - else unclaimedPolicy "reserve" -> moved to `reserve:unclaimed`
 *       - else unclaimedPolicy "jackpot" -> carried out to the next jackpot
 *  5. Every movement is recorded as a ledger entry and validated.
 */
import { validateLedger } from "./ledger.ts";
import { MoneyError, assertMinor, percentOf, splitAmongRecipients, sum, BPS_DENOMINATOR } from "./money.ts";
import { MATCH_TIERS, type LedgerEntry, type MatchTier, type TierConfig } from "./types.ts";

export interface TierAllocation {
  tier: MatchTier;
  allocationMinor: number;
  carryInMinor: number;
  fundMinor: number;
  winnerCount: number;
  paidMinor: number;
  unclaimedMinor: number;
}

export interface PrizePayout {
  userId: string;
  tier: MatchTier;
  amountMinor: number;
}

export interface PrizeResult {
  tiers: Record<MatchTier, TierAllocation>;
  payouts: PrizePayout[];
  jackpotCarryOutMinor: number;
  reserveMinor: number;
  ledger: LedgerEntry[];
}

export interface AllocateInput {
  drawId: string;
  poolMinor: number;
  jackpotCarryInMinor: number;
  tierConfig: TierConfig;
  winnersByTier: Record<MatchTier, readonly string[]>;
}

export function validateTierConfig(cfg: TierConfig): void {
  const total = sum(MATCH_TIERS.map((t) => cfg.shareBps[t]));
  for (const t of MATCH_TIERS) {
    const bps = cfg.shareBps[t];
    if (!Number.isInteger(bps) || bps < 0) throw new MoneyError(`invalid shareBps for tier ${t}`);
  }
  if (total !== BPS_DENOMINATOR) {
    throw new MoneyError(`tier shares must sum to ${BPS_DENOMINATOR} bps, got ${total}`);
  }
}

export function allocatePrizes(input: AllocateInput): PrizeResult {
  const { drawId, poolMinor, jackpotCarryInMinor, tierConfig, winnersByTier } = input;
  assertMinor(poolMinor, "pool");
  assertMinor(jackpotCarryInMinor, "jackpot carry-in");
  validateTierConfig(tierConfig);

  const allocations: Record<MatchTier, number> = {
    5: percentOf(poolMinor, tierConfig.shareBps[5]),
    4: percentOf(poolMinor, tierConfig.shareBps[4]),
    3: percentOf(poolMinor, tierConfig.shareBps[3]),
  };
  const dust = poolMinor - sum(MATCH_TIERS.map((t) => allocations[t]));
  allocations[5] += dust;

  const ledger: LedgerEntry[] = [];
  const tiers = {} as Record<MatchTier, TierAllocation>;
  const payouts: PrizePayout[] = [];
  let jackpotCarryOutMinor = 0;
  let reserveMinor = 0;

  const push = (e: LedgerEntry) => {
    if (e.amountMinor > 0) ledger.push(e);
  };

  for (const tier of MATCH_TIERS) {
    const carryIn = tier === 5 ? jackpotCarryInMinor : 0;
    const fund = allocations[tier] + carryIn;
    const winners = winnersByTier[tier];
    const account = `tier:${tier}`;

    push({ from: `pool:${drawId}`, to: account, amountMinor: allocations[tier], kind: "tier_allocation", ref: account });
    push({ from: "jackpot:carry_in", to: account, amountMinor: carryIn, kind: "jackpot_carry_in", ref: account });

    let paid = 0;
    let unclaimed = 0;
    if (winners.length > 0) {
      const shares = splitAmongRecipients(fund, winners, `${drawId}:${tier}`);
      for (const [userId, amountMinor] of shares) {
        payouts.push({ userId, tier, amountMinor });
        push({ from: account, to: `winner:${userId}`, amountMinor, kind: "prize", ref: `${account}:${userId}` });
        paid += amountMinor;
      }
    } else if (tierConfig.rollover[tier] || tierConfig.unclaimedPolicy === "jackpot") {
      unclaimed = fund;
      jackpotCarryOutMinor += fund;
      push({ from: account, to: "jackpot:carry_out", amountMinor: fund, kind: "jackpot_rollover", ref: account });
    } else {
      unclaimed = fund;
      reserveMinor += fund;
      push({ from: account, to: "reserve:unclaimed", amountMinor: fund, kind: "unclaimed_reserve", ref: account });
    }

    tiers[tier] = {
      tier,
      allocationMinor: allocations[tier],
      carryInMinor: carryIn,
      fundMinor: fund,
      winnerCount: winners.length,
      paidMinor: paid,
      unclaimedMinor: unclaimed,
    };
  }

  validateLedger(ledger, poolMinor + jackpotCarryInMinor);
  return { tiers, payouts, jackpotCarryOutMinor, reserveMinor, ledger };
}
