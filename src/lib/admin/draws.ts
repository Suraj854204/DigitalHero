import "server-only";
import {
  computeDrawResult, cryptoRandomSource, DEFAULT_TIER_CONFIG, toPublishPayload,
  type DrawConfig, type FrozenParticipant, type TierConfig,
} from "../draw-engine/index.ts";
import { createAdminClient } from "../supabase/admin.ts";

type Db = ReturnType<typeof createAdminClient>;

export interface DrawRow {
  id: string; title: string; period_month: string; status: "draft" | "simulated" | "approved" | "published" | "cancelled";
  mode: "random" | "weighted"; weight_bias: "frequent" | "rare"; weight_smoothing: number; eligibility_cutoff: string;
  tier_config: TierConfig; pool_minor: number | null; jackpot_carry_in_minor: number | null; snapshot_hash: string | null;
  participant_count: number | null; winning_numbers: number[] | null; result_hash: string | null; published_at: string | null;
  approved_at: string | null; random_source: string | null; notes: string | null;
}

const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

export async function loadDraw(db: Db, id: string): Promise<DrawRow> {
  const row = must(await db.from("draws").select("*").eq("id", id).maybeSingle(), "load draw");
  if (!row) throw new Error("NOT_FOUND: draw not found");
  return row as DrawRow;
}

/** Build participants from raw SQL snapshot rows (grouped per user, newest first). */
export function groupSnapshotRows(rows: { user_id: string; pos?: number; position?: number; score_date: string; value: number }[]): FrozenParticipant[] {
  const by = new Map<string, FrozenParticipant & { scores: { id: string; scoreDate: string; value: number }[] }>();
  for (const r of rows) {
    if (!by.has(r.user_id)) by.set(r.user_id, { userId: r.user_id, scores: [] });
    const p = r.pos ?? r.position ?? 0;
    by.get(r.user_id)!.scores.push({ id: `${r.user_id}-${p}`, scoreDate: String(r.score_date).slice(0, 10), value: r.value });
  }
  return [...by.values()];
}

export async function loadFrozenParticipants(db: Db, drawId: string): Promise<FrozenParticipant[]> {
  const rows = must(await db.from("draw_score_snapshots").select("user_id, position, score_date, value").eq("draw_id", drawId).order("user_id").order("position").range(0, 99999), "load snapshot");
  return groupSnapshotRows(rows as never);
}

export function toConfig(d: DrawRow, pool: number, carry: number): DrawConfig {
  return { drawId: d.id, mode: d.mode, weightBias: d.weight_bias, weightSmoothing: d.weight_smoothing, tierConfig: d.tier_config ?? DEFAULT_TIER_CONFIG, poolMinor: pool, jackpotCarryInMinor: carry };
}

/**
 * SIMULATION: reads live eligibility, computes a hypothetical result and stores ONLY a summary row.
 * It cannot touch ledgers, winnings, jackpot or contributions (it never calls a money-writing function),
 * and the simulated numbers are NOT reused at publication (publication draws fresh numbers).
 */
export async function runSimulation(db: Db, drawId: string, actorId: string) {
  const d = await loadDraw(db, drawId);
  if (!["draft", "simulated"].includes(d.status)) throw new Error(`TRANSITION: a ${d.status} draw cannot be simulated`);
  const snap = must(await db.rpc("compute_eligible_snapshot", { p_cutoff: d.eligibility_cutoff }), "eligibility");
  const participants = groupSnapshotRows(snap as never);
  const pool = Number(must(await db.rpc("unallocated_pool_minor", { p_cutoff: d.eligibility_cutoff }), "pool"));
  const carry = Number(must(await db.rpc("public_jackpot_balance"), "jackpot"));
  const result = computeDrawResult(toConfig(d, pool, carry), participants, cryptoRandomSource);
  const summary = {
    participants: result.participantCount, poolMinor: pool, jackpotCarryInMinor: carry,
    winnersByTier: { 5: result.matches.winnersByTier[5].length, 4: result.matches.winnersByTier[4].length, 3: result.matches.winnersByTier[3].length },
    paidMinor: result.prizes.payouts.reduce((a, p) => a + p.amountMinor, 0), carryOutMinor: result.prizes.jackpotCarryOutMinor, reserveMinor: result.prizes.reserveMinor,
    tiers: result.prizes.tiers, weights: result.weights, simulated: true,
  };
  must(await db.rpc("record_simulation", { p_draw: drawId, p_actor: actorId, p_numbers: result.winningNumbers, p_source: result.randomSource, p_summary: summary }), "record simulation");
  return summary;
}

/** PUBLICATION: draws fresh numbers from the CSPRNG over the FROZEN snapshot; SQL re-verifies everything. */
export async function runPublish(db: Db, drawId: string, actorId: string) {
  const d = await loadDraw(db, drawId);
  if (d.status === "published") return must(await db.rpc("publish_draw", { p_draw: drawId, p_actor: actorId, p_result: {} }), "publish");
  if (d.status !== "approved") throw new Error(`TRANSITION: only an approved draw can be published (currently ${d.status})`);
  const participants = await loadFrozenParticipants(db, drawId);
  const result = computeDrawResult(toConfig(d, Number(d.pool_minor), Number(d.jackpot_carry_in_minor)), participants, cryptoRandomSource);
  return must(await db.rpc("publish_draw", { p_draw: drawId, p_actor: actorId, p_result: toPublishPayload(result) }), "publish");
}
