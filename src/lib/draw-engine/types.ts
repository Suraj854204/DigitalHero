/** Shared types for the draw engine. Pure data, no behaviour, no framework imports. */

export const NUMBER_MIN = 1;
export const NUMBER_MAX = 45;
export const NUMBERS_PER_DRAW = 5;
export const SCORES_REQUIRED = 5;

export type DrawMode = "random" | "weighted";
export type WeightBias = "frequent" | "rare";
export type MatchTier = 5 | 4 | 3;
export const MATCH_TIERS: readonly MatchTier[] = [5, 4, 3] as const;

export type DrawStatus = "draft" | "simulated" | "approved" | "published" | "cancelled";

export interface ScoreRecord {
  id: string;
  /** ISO date (YYYY-MM-DD) the round was played. */
  scoreDate: string;
  value: number;
}

export interface SubscriptionPeriod {
  /** Matches the DB enum: active | canceling | past_due | lapsed | canceled | incomplete */
  status: string;
  /** ISO timestamp the paid access began. */
  activeFrom: string;
  /** ISO timestamp paid access ends (current period end or termination). null = open ended. */
  activeUntil: string | null;
}

export interface CandidateUser {
  userId: string;
  subscription: SubscriptionPeriod | null;
  scores: readonly ScoreRecord[];
}

export interface FrozenParticipant {
  userId: string;
  /** Exactly SCORES_REQUIRED scores, newest first. Immutable once approved. */
  scores: readonly ScoreRecord[];
}

export interface TierConfig {
  /** Share of the prize pool in basis points. Must sum to 10_000 across tiers. */
  shareBps: Record<MatchTier, number>;
  /** Only the 5-match tier rolls over per the PRD. */
  rollover: Record<MatchTier, boolean>;
  /**
   * What happens to an unclaimed non-rollover tier:
   *  - "reserve": moves to an explicit `reserve:unclaimed` ledger account (default).
   *  - "jackpot": added to the jackpot carry-out (admin opt-in policy).
   */
  unclaimedPolicy: "reserve" | "jackpot";
}

export const DEFAULT_TIER_CONFIG: TierConfig = {
  shareBps: { 5: 4000, 4: 3500, 3: 2500 },
  rollover: { 5: true, 4: false, 3: false },
  unclaimedPolicy: "reserve",
};

export interface LedgerEntry {
  /** Source account; funds leave here. */
  from: string;
  /** Destination account; funds arrive here. */
  to: string;
  amountMinor: number;
  kind: string;
  /** Free-form reference, e.g. `tier:5` or a user id. */
  ref?: string;
}
