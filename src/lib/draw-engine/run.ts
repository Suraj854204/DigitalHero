/**
 * Orchestration: compute a draw result (pure) and publish it idempotently
 * through a store port.
 *
 * `computeDrawResult` has NO side effects, so a simulation is literally the same
 * call without a store: it cannot write ledger entries, payouts or status.
 *
 * The production store is the SQL function `public.publish_draw` (row lock +
 * status check inside one transaction). `InMemoryDrawStore` implements the same
 * contract so the engine's idempotency and race behaviour is unit-tested here.
 */
import { createHash } from "node:crypto";
import { matchParticipants, type MatchRun } from "./matching.ts";
import { drawRandomNumbers, drawWeightedNumbers, frequencyFromScores, validateWinningNumbers } from "./numbers.ts";
import { allocatePrizes, type PrizeResult } from "./prizes.ts";
import type { RandomSource } from "./rng.ts";
import { assertDrawTransition, TransitionError } from "./state.ts";
import {
  DEFAULT_TIER_CONFIG,
  type DrawMode,
  type DrawStatus,
  type FrozenParticipant,
  type TierConfig,
  type WeightBias,
} from "./types.ts";

export interface DrawConfig {
  drawId: string;
  mode: DrawMode;
  weightBias?: WeightBias;
  weightSmoothing?: number;
  tierConfig?: TierConfig;
  /** New prize-pool money recognised for this draw period (minor units). */
  poolMinor: number;
  /** Jackpot carried in from the jackpot ledger (minor units). */
  jackpotCarryInMinor: number;
}

export interface DrawResult {
  drawId: string;
  mode: DrawMode;
  winningNumbers: number[];
  /** Effective weights recorded for audit (weighted mode only). */
  weights: number[] | null;
  weightedFallbackFilled: number;
  randomSource: RandomSource["kind"];
  participantCount: number;
  snapshotHash: string;
  matches: MatchRun;
  prizes: PrizeResult;
  /** sha256 over the canonical result; stored so later tampering is detectable. */
  resultHash: string;
}

/** Canonical, order-independent hash of a snapshot. */
export function hashSnapshot(participants: readonly FrozenParticipant[]): string {
  const canonical = [...participants]
    .sort((a, b) => (a.userId < b.userId ? -1 : 1))
    .map((p) => [p.userId, p.scores.map((s) => `${s.scoreDate}:${s.value}`).join(",")].join("|"))
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

export function computeDrawResult(
  config: DrawConfig,
  participants: readonly FrozenParticipant[],
  rng: RandomSource,
): DrawResult {
  let winningNumbers: number[];
  let weights: number[] | null = null;
  let weightedFallbackFilled = 0;

  if (config.mode === "weighted") {
    const freq = frequencyFromScores(participants.flatMap((p) => p.scores));
    const w = drawWeightedNumbers(freq, rng, { bias: config.weightBias, smoothing: config.weightSmoothing });
    winningNumbers = w.numbers;
    weights = w.weights;
    weightedFallbackFilled = w.fallbackFilled;
  } else {
    winningNumbers = drawRandomNumbers(rng);
  }
  validateWinningNumbers(winningNumbers);

  const matches = matchParticipants(winningNumbers, participants);
  const prizes = allocatePrizes({
    drawId: config.drawId,
    poolMinor: config.poolMinor,
    jackpotCarryInMinor: config.jackpotCarryInMinor,
    tierConfig: config.tierConfig ?? DEFAULT_TIER_CONFIG,
    winnersByTier: matches.winnersByTier,
  });

  const snapshotHash = hashSnapshot(participants);
  const body = {
    drawId: config.drawId,
    mode: config.mode,
    winningNumbers,
    snapshotHash,
    payouts: [...prizes.payouts].sort((a, b) => (a.userId < b.userId ? -1 : 1)),
    carryOut: prizes.jackpotCarryOutMinor,
    reserve: prizes.reserveMinor,
  };
  const resultHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");

  return {
    drawId: config.drawId,
    mode: config.mode,
    winningNumbers,
    weights,
    weightedFallbackFilled,
    randomSource: rng.kind,
    participantCount: participants.length,
    snapshotHash,
    matches,
    prizes,
    resultHash,
  };
}

/** Simulation = compute only. Never touches a store. */
export function simulateDraw(
  config: DrawConfig,
  participants: readonly FrozenParticipant[],
  rng: RandomSource,
): DrawResult & { simulated: true } {
  return { ...computeDrawResult(config, participants, rng), simulated: true };
}

/* ------------------------------ Store port ---------------------------- */
export type CommitOutcome = { outcome: "committed" } | { outcome: "already_published"; existing: DrawResult };

export interface DrawStore {
  getStatus(drawId: string): DrawStatus | undefined;
  getFrozenSnapshot(drawId: string): { participants: readonly FrozenParticipant[]; hash: string } | undefined;
  getResult(drawId: string): DrawResult | undefined;
  /** Atomic compare-and-set: approved -> published plus ledger/payout writes, or reports already_published. */
  commitPublication(drawId: string, result: DrawResult): CommitOutcome;
}

export type PublishOutcome =
  | { outcome: "published"; result: DrawResult }
  | { outcome: "already_published"; result: DrawResult };

export function publishDraw(store: DrawStore, config: DrawConfig, rng: RandomSource): PublishOutcome {
  const status = store.getStatus(config.drawId);
  if (!status) throw new TransitionError(`draw ${config.drawId} not found`);
  if (status !== "approved" && status !== "published") {
    assertDrawTransition(status, "published"); // throws with a precise message
  }
  const snapshot = store.getFrozenSnapshot(config.drawId);
  if (!snapshot) throw new TransitionError(`draw ${config.drawId} has no frozen snapshot`);
  if (hashSnapshot(snapshot.participants) !== snapshot.hash) {
    throw new TransitionError("frozen snapshot hash mismatch: snapshot was altered after approval");
  }
  if (status === "published") {
    // Idempotent replay: return the stored result, write nothing, draw no new numbers.
    const existing = store.getResult(config.drawId);
    if (!existing) throw new TransitionError(`draw ${config.drawId} is published but has no stored result`);
    return { outcome: "already_published", result: existing };
  }
  const result = computeDrawResult(config, snapshot.participants, rng);
  const commit = store.commitPublication(config.drawId, result);
  return commit.outcome === "committed"
    ? { outcome: "published", result }
    : { outcome: "already_published", result: commit.existing };
}

/** Reference implementation of the store contract, used by unit tests. */
export class InMemoryDrawStore implements DrawStore {
  readonly ledger: { drawId: string; entries: PrizeResult["ledger"] }[] = [];
  readonly payouts: { drawId: string; userId: string; tier: number; amountMinor: number }[] = [];
  readonly jackpotLedger: { drawId: string; deltaMinor: number }[] = [];
  private draws = new Map<
    string,
    { status: DrawStatus; snapshot?: { participants: readonly FrozenParticipant[]; hash: string }; result?: DrawResult }
  >();

  addDraw(drawId: string, status: DrawStatus, participants?: readonly FrozenParticipant[]): void {
    this.draws.set(drawId, {
      status,
      snapshot: participants ? { participants, hash: hashSnapshot(participants) } : undefined,
    });
  }

  tamperSnapshot(drawId: string, participants: readonly FrozenParticipant[]): void {
    const d = this.draws.get(drawId);
    if (d?.snapshot) d.snapshot = { participants, hash: d.snapshot.hash };
  }

  getStatus(drawId: string) {
    return this.draws.get(drawId)?.status;
  }
  getFrozenSnapshot(drawId: string) {
    return this.draws.get(drawId)?.snapshot;
  }
  getResult(drawId: string) {
    return this.draws.get(drawId)?.result;
  }
  commitPublication(drawId: string, result: DrawResult): CommitOutcome {
    const d = this.draws.get(drawId);
    if (!d) throw new TransitionError(`draw ${drawId} not found`);
    if (d.status === "published" && d.result) return { outcome: "already_published", existing: d.result };
    if (d.status !== "approved") assertDrawTransition(d.status, "published");
    d.status = "published";
    d.result = result;
    this.ledger.push({ drawId, entries: result.prizes.ledger });
    for (const p of result.prizes.payouts) this.payouts.push({ drawId, ...p });
    // Jackpot ledger: carry-in consumed (negative), carry-out created (positive).
    this.jackpotLedger.push({
      drawId,
      deltaMinor: result.prizes.jackpotCarryOutMinor - result.prizes.tiers[5].carryInMinor,
    });
    return { outcome: "committed" };
  }
}
