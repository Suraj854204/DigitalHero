import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getPublishedDraws } from "@/lib/data/public";
import { formatMonth } from "@/lib/format";
import { requireUserPage } from "@/lib/session";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Draws" };

export default async function Draws() {
  await requireUserPage();
  const draws = await getPublishedDraws(24);
  const supabase = await createUserClient();
  const { data: mine } = await supabase.from("draw_matches").select("draw_id, match_count, tier");
  const byDraw = new Map((mine ?? []).map((m) => [m.draw_id as string, m]));
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Draws" title="Every published" accent="result.">Results can't change once published. Open a draw to see your frozen scores and how it was decided.</PageHeader>
      {draws.length === 0 ? <EmptyState title="No draws published yet">When the first draw is published, it will appear here.</EmptyState> : (
        <ul className="grid gap-4 sm:grid-cols-2">{draws.map((d) => { const m = byDraw.get(d.id); return (
          <li key={d.id}><Link href={`/app/draws/${d.id}`}><Card className="card-lift"><p className="font-mono text-xs uppercase tracking-widest text-muted">{formatMonth(d.period_month)}</p>
            <ul className="mt-3 flex gap-2" aria-label="Winning numbers">{d.winning_numbers.map((n) => <li key={n} className="grid size-10 place-items-center rounded-full bg-forest font-bold text-white tabular-nums">{n}</li>)}</ul>
            <p className="mt-4 text-sm">{m ? (m.tier ? <span className="font-semibold text-forest">You matched {m.match_count}: prize won</span> : <>You matched {m.match_count}</>) : <span className="text-muted">You weren't in this draw</span>}</p></Card></Link></li>); })}</ul>)}
    </div>
  );
}
