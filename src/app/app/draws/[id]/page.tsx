import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Card, Money, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { bpsToPercent, formatDate, formatMonth } from "@/lib/format";
import { requireUserPage } from "@/lib/session";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Draw details" };

export default async function DrawDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireUserPage();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createUserClient();
  const { data: draw } = await supabase.from("draws").select("*").eq("id", id).eq("status", "published").maybeSingle(); // RLS: published only
  if (!draw) notFound();
  const [{ data: allocs }, { data: snap }, { data: match }, { data: win }] = await Promise.all([
    supabase.from("prize_allocations").select("*").eq("draw_id", id).order("tier", { ascending: false }),
    supabase.from("draw_score_snapshots").select("position, score_date, value").eq("draw_id", id).eq("user_id", actor.id).order("position"),
    supabase.from("draw_matches").select("match_count, tier").eq("draw_id", id).maybeSingle(),
    supabase.from("winnings").select("id, amount_minor, claim_status").eq("draw_id", id).maybeSingle(),
  ]);
  const winning = new Set<number>(draw.winning_numbers);
  const cfg = draw.tier_config as { shareBps: Record<string, number> };
  const rolled = (allocs ?? []).reduce((a, r) => a + (r.winner_count === 0 && r.tier === 5 ? Number(r.unclaimed_minor) : 0), 0);

  return (
    <div className="space-y-8">
      <Link href="/app/draws" className="text-sm font-semibold text-forest underline underline-offset-4">← All draws</Link>
      <PageHeader eyebrow={formatMonth(draw.period_month)} title={draw.title} accent="results.">Published {formatDate(draw.published_at, true)} · {draw.participant_count} participants · {draw.mode} mode</PageHeader>
      <Card><h2 className="text-lg font-bold">Winning numbers</h2>
        <ul className="mt-4 flex flex-wrap gap-3" aria-label="Winning numbers">{draw.winning_numbers.map((n: number) => <li key={n} className="grid size-14 place-items-center rounded-full bg-forest text-xl font-bold text-white tabular-nums">{n}</li>)}</ul></Card>

      <Card><h2 className="text-lg font-bold">Your frozen scores</h2>
        {(snap ?? []).length === 0 ? <p className="mt-3 text-sm text-muted">You weren't eligible for this draw: no snapshot was taken for your account.</p> : (<>
          <p className="mt-1 text-sm text-muted">These are the five scores locked at the eligibility cutoff. Highlighted values matched a winning number.</p>
          <ul className="mt-4 flex flex-wrap gap-3">{snap!.map((s) => <li key={s.position} className={`rounded-[var(--radius-md)] border px-4 py-3 text-center ${winning.has(s.value) ? "border-forest bg-mint" : "border-line bg-paper"}`}><p className="text-2xl font-bold tabular-nums">{s.value}</p><p className="text-xs text-muted">{formatDate(s.score_date)}</p></li>)}</ul>
          <p className="mt-4 text-sm">{match?.tier ? <><strong>You matched {match.match_count} — you won {win && <Money minor={win.amount_minor} />}.</strong> {win && <Link className="underline" href={`/app/winnings/${win.id}`}>Claim status: <StatusBadge status={win.claim_status} /></Link>}</> : <>You matched {match?.match_count ?? 0}. Three or more win a prize.</>}</p></>)}
      </Card>

      <Card><h2 className="text-lg font-bold">Prize pool and tiers</h2>
        <p className="mt-1 text-sm text-muted">Prize pool <Money minor={draw.pool_minor} /> plus jackpot carried in <Money minor={draw.jackpot_carry_in_minor} />.</p>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[480px] text-left text-sm"><thead className="font-mono text-xs uppercase tracking-wider text-muted"><tr><th className="py-2">Tier</th><th>Share</th><th>Fund</th><th>Winners</th><th>Unclaimed</th></tr></thead>
          <tbody className="divide-y divide-line">{(allocs ?? []).map((a) => <tr key={a.tier}><td className="py-3 font-semibold">{a.tier} matches</td><td>{bpsToPercent(cfg.shareBps[String(a.tier)])}</td><td><Money minor={a.fund_minor} /></td><td>{a.winner_count}</td><td><Money minor={a.unclaimed_minor} /></td></tr>)}</tbody></table></div>
        {rolled > 0 && <Alert tone="info" className="mt-4">Nobody matched five numbers, so <Money minor={rolled} /> rolled over into the next jackpot.</Alert>}
      </Card>
      <p className="text-xs text-muted">Result fingerprint: <span className="font-mono">{draw.result_hash?.slice(0, 16)}…</span> · Numbers drawn with a {draw.random_source} random source. Only you can see your own scores; other participants' details are never shown.</p>
    </div>
  );
}
