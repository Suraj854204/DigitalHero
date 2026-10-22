/**
 * Serialises a DrawResult into the JSON contract consumed by the SQL function
 * public.publish_draw(draw_id, actor_id, payload). SQL re-derives and re-checks every figure,
 * so this is a transport format, not a source of trust.
 */
import type { DrawResult } from "./run.ts";

export interface PublishPayload {
  winningNumbers: number[];
  mode: string;
  weights: number[] | null;
  randomSource: string;
  resultHash: string;
  snapshotHash: string;
  matches: { userId: string; matches: number; tier: number | null }[];
  allocations: {
    tier: number;
    allocationMinor: number;
    carryInMinor: number;
    fundMinor: number;
    winnerCount: number;
    paidMinor: number;
    unclaimedMinor: number;
  }[];
  payouts: { userId: string; tier: number; amountMinor: number }[];
  carryOutMinor: number;
  reserveMinor: number;
  ledger: { from: string; to: string; amountMinor: number; kind: string; ref: string | null }[];
}

export function toPublishPayload(r: DrawResult): PublishPayload {
  return {
    winningNumbers: r.winningNumbers,
    mode: r.mode,
    weights: r.weights,
    randomSource: r.randomSource,
    resultHash: r.resultHash,
    snapshotHash: r.snapshotHash,
    matches: r.matches.outcomes.map((o) => ({ userId: o.userId, matches: o.matches, tier: o.tier })),
    allocations: ([5, 4, 3] as const).map((t) => ({
      tier: t,
      allocationMinor: r.prizes.tiers[t].allocationMinor,
      carryInMinor: r.prizes.tiers[t].carryInMinor,
      fundMinor: r.prizes.tiers[t].fundMinor,
      winnerCount: r.prizes.tiers[t].winnerCount,
      paidMinor: r.prizes.tiers[t].paidMinor,
      unclaimedMinor: r.prizes.tiers[t].unclaimedMinor,
    })),
    payouts: r.prizes.payouts.map((p) => ({ userId: p.userId, tier: p.tier, amountMinor: p.amountMinor })),
    carryOutMinor: r.prizes.jackpotCarryOutMinor,
    reserveMinor: r.prizes.reserveMinor,
    ledger: r.prizes.ledger.map((l) => ({ from: l.from, to: l.to, amountMinor: l.amountMinor, kind: l.kind, ref: l.ref ?? null })),
  };
}
