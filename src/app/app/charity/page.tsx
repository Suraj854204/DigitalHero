import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui/primitives";
import { getCharities } from "@/lib/data/public";
import { getMyCharitySelection } from "@/lib/data/subscriber";
import { formatDate } from "@/lib/format";
import { requireUserPage } from "@/lib/session";
import { createUserClient } from "@/lib/supabase/server";
import { CharityForm } from "./charity-form";

export const metadata: Metadata = { title: "My charity" };

export default async function MyCharity() {
  await requireUserPage();
  const [sel, { items }] = await Promise.all([getMyCharitySelection(), getCharities({ pageSize: 48 })]);
  const supabase = await createUserClient();
  const { data: history } = await supabase.from("charity_selections").select("id, contribution_bps, effective_from, charities(name)").order("effective_from", { ascending: false }).limit(10);
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="My charity" title="Who your giving" accent="supports.">Change your charity or contribution any time. Money already recorded stays with the charity it was booked to.</PageHeader>
      <Card><CharityForm charities={items.map((c) => ({ id: c.id, name: c.name, category: c.category }))} currentId={sel?.charity_id} currentPercent={(sel?.contribution_bps ?? 1000) / 100} /></Card>
      <section><h2 className="mb-3 text-lg font-bold">Selection history</h2>
        {(history ?? []).length === 0 ? <p className="text-sm text-muted">No selections yet.</p> : (
          <ul className="divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-card">{(history as unknown as { id: string; contribution_bps: number; effective_from: string; charities: { name: string } | null }[]).map((h) => (
            <li key={h.id} className="flex justify-between gap-3 px-5 py-3 text-sm"><span>{h.charities?.name} · {h.contribution_bps / 100}%</span><span className="text-muted">from {formatDate(h.effective_from, true)}</span></li>))}</ul>)}
      </section>
    </div>
  );
}
