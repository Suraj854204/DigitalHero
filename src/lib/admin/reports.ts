import "server-only";
import { createAdminClient } from "../supabase/admin.ts";

export const REPORT_TYPES = {
  revenue: "Subscription revenue",
  charity: "Charity contributions",
  participation: "Draw participation",
  prizes: "Prize allocation",
  rollover: "Jackpot rollover",
  verification: "Winner verification",
  payouts: "Payout status",
} as const;
export type ReportType = keyof typeof REPORT_TYPES;
export const isReportType = (v: string): v is ReportType => v in REPORT_TYPES;

type Row = Record<string, string | number | null>;
const must = <T>(r: { data: T | null; error: { message: string } | null }, w: string): T => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return (r.data ?? []) as T; };

/** Every money figure comes from ledger-backed tables (contributions/prize_allocations/jackpot_ledger/payouts), never from display totals. */
export async function getReport(type: ReportType, from: string, to: string): Promise<Row[]> {
  const db = createAdminClient();
  const fromTs = `${from}T00:00:00Z`;
  const toTs = `${to}T23:59:59.999Z`;
  switch (type) {
    case "revenue": {
      const rows = must(await db.from("contributions").select("kind, amount_minor, charity_minor, pool_minor, platform_minor, recognized_at").gte("recognized_at", fromTs).lte("recognized_at", toTs).limit(50000), "revenue");
      const by = new Map<string, Row>();
      for (const r of rows) {
        const key = `${String(r.recognized_at).slice(0, 7)}|${r.kind}`;
        const cur = by.get(key) ?? { month: String(r.recognized_at).slice(0, 7), kind: r.kind, payments: 0, amount_minor: 0, charity_minor: 0, pool_minor: 0, platform_minor: 0 };
        cur.payments = Number(cur.payments) + 1;
        for (const k of ["amount_minor", "charity_minor", "pool_minor", "platform_minor"] as const) cur[k] = Number(cur[k]) + Number(r[k]);
        by.set(key, cur);
      }
      return [...by.values()].sort((a, b) => String(a.month).localeCompare(String(b.month)));
    }
    case "charity": {
      const rows = must(await db.from("contributions").select("charity_minor, charities(name)").gte("recognized_at", fromTs).lte("recognized_at", toTs).limit(50000), "charity");
      const by = new Map<string, Row>();
      for (const r of rows as unknown as { charity_minor: number; charities: { name: string } | null }[]) {
        const name = r.charities?.name ?? "(no charity recorded)";
        const cur = by.get(name) ?? { charity: name, contributions: 0, allocated_minor: 0 };
        cur.contributions = Number(cur.contributions) + 1; cur.allocated_minor = Number(cur.allocated_minor) + Number(r.charity_minor);
        by.set(name, cur);
      }
      return [...by.values()].sort((a, b) => Number(b.allocated_minor) - Number(a.allocated_minor));
    }
    case "participation": {
      const draws = must(await db.from("draws").select("id, title, period_month, status, participant_count").gte("period_month", from.slice(0, 7) + "-01").lte("period_month", to).order("period_month"), "participation");
      const matches = must(await db.from("draw_matches").select("draw_id, tier").range(0, 99999), "matches");
      return draws.map((d) => { const m = matches.filter((x) => x.draw_id === d.id); return { draw: d.title, month: String(d.period_month).slice(0, 7), status: d.status, participants: d.participant_count, winners: m.filter((x) => x.tier).length, three_match: m.filter((x) => x.tier === 3).length, four_match: m.filter((x) => x.tier === 4).length, five_match: m.filter((x) => x.tier === 5).length }; });
    }
    case "prizes": {
      const rows = must(await db.from("prize_allocations").select("draw_id, tier, allocation_minor, carry_in_minor, fund_minor, winner_count, paid_minor, unclaimed_minor, draws!inner(title, period_month, published_at)").gte("draws.published_at", fromTs).lte("draws.published_at", toTs).order("draw_id").order("tier", { ascending: false }), "prizes");
      return (rows as unknown as { tier: number; allocation_minor: number; carry_in_minor: number; fund_minor: number; winner_count: number; paid_minor: number; unclaimed_minor: number; draws: { title: string } }[]).map((r) => ({ draw: r.draws.title, tier: r.tier, allocation_minor: r.allocation_minor, carry_in_minor: r.carry_in_minor, fund_minor: r.fund_minor, winners: r.winner_count, paid_minor: r.paid_minor, unclaimed_minor: r.unclaimed_minor }));
    }
    case "rollover": {
      const rows = must(await db.from("jackpot_ledger").select("id, entry_type, delta_minor, created_at, draws(title)").gte("created_at", fromTs).lte("created_at", toTs).order("id"), "rollover");
      let running = 0;
      return (rows as unknown as { entry_type: string; delta_minor: number; created_at: string; draws: { title: string } | null }[]).map((r) => { running += Number(r.delta_minor); return { when: String(r.created_at).slice(0, 10), draw: r.draws?.title ?? "", entry: r.entry_type, delta_minor: r.delta_minor, running_balance_minor: running }; });
    }
    case "verification": {
      const rows = must(await db.from("winnings").select("claim_status, amount_minor").gte("created_at", fromTs).lte("created_at", toTs).limit(50000), "verification");
      const by = new Map<string, Row>();
      for (const r of rows) { const cur = by.get(r.claim_status) ?? { claim_status: r.claim_status, winnings: 0, amount_minor: 0 }; cur.winnings = Number(cur.winnings) + 1; cur.amount_minor = Number(cur.amount_minor) + Number(r.amount_minor); by.set(r.claim_status, cur); }
      return [...by.values()];
    }
    case "payouts": {
      const rows = must(await db.from("payouts").select("status, amount_minor, reference, method, queued_at, paid_at").gte("queued_at", fromTs).lte("queued_at", toTs).order("queued_at", { ascending: false }).limit(5000), "payouts");
      return rows.map((r) => ({ queued: String(r.queued_at).slice(0, 10), status: r.status, amount_minor: r.amount_minor, reference: r.reference, method: r.method, paid: r.paid_at ? String(r.paid_at).slice(0, 10) : null }));
    }
  }
}
