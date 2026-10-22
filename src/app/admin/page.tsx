import Link from "next/link";
import { TrendChart } from "@/components/charts/trend-chart";
import { Alert, Card, DemoBadge, Money, PageHeader, Stat, StatusBadge } from "@/components/ui/primitives";
import { summarizeReport } from "@/lib/ai/report-summary";
import { daysAgoISO, formatMonth } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function AdminOverview() {
  await requireAdminPage();
  const db = createAdminClient();
  const since = daysAgoISO(180);
  const [users, subs, contrib, draws, reviews, pendingPayouts, hist, charities, recon] = await Promise.all([
    db.from("profiles").select("id", { count: "exact", head: true }),
    db.from("subscriptions").select("status").limit(100000),
    db.from("contributions").select("amount_minor, charity_minor, pool_minor").limit(100000),
    db.from("draws").select("id, title, period_month, status").order("period_month", { ascending: false }).limit(4),
    db.from("winner_evidence").select("id", { count: "exact", head: true }).eq("review_status", "pending"),
    db.from("payouts").select("amount_minor").eq("status", "pending"),
    db.from("subscription_history").select("effective_from, status").eq("status", "active").gte("effective_from", since).limit(100000),
    db.from("charities").select("id, is_demo").eq("status", "active"),
    db.from("v_reconciliation").select("check_name, ledger_minor, source_minor"),
  ]);
  const by = (s: string) => (subs.data ?? []).filter((x) => x.status === s).length;
  const sum = (k: "amount_minor" | "charity_minor" | "pool_minor") => (contrib.data ?? []).reduce((a, r) => a + Number(r[k]), 0);
  const trendMap = new Map<string, number>();
  for (const h of hist.data ?? []) { const m = String(h.effective_from).slice(0, 7); trendMap.set(m, (trendMap.get(m) ?? 0) + 1); }
  const trend = [...trendMap.entries()].sort().map(([month, value]) => ({ month, value }));
  const bad = (recon.data ?? []).filter((r) => Number(r.ledger_minor) !== Number(r.source_minor));
  const demoCount = (charities.data ?? []).filter((c) => c.is_demo).length;
  const ai = await summarizeReport({ periodLabel: "All time", activeSubscriptions: by("active") + by("canceling"), newSubscriptions: trend.at(-1)?.value ?? 0, revenueMinor: sum("amount_minor"), charityMinor: sum("charity_minor"), poolMinor: sum("pool_minor"), pendingReviews: reviews.count ?? 0, pendingPayouts: pendingPayouts.data?.length ?? 0 });

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Overview" title="The platform," accent="at a glance.">All figures are queried live from the database and ledger.</PageHeader>
      {demoCount > 0 && <Alert tone="warn"><DemoBadge /> {demoCount} active charities are flagged as demo data. Archive or edit them before launch.</Alert>}
      {bad.length > 0 && <Alert tone="error"><strong>Ledger reconciliation mismatch:</strong> {bad.map((b) => b.check_name).join("; ")}. Investigate before publishing a draw.</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Registered users" value={users.count ?? 0} />
        <Stat label="Active subscriptions" value={by("active") + by("canceling")} hint={`${by("canceling")} cancelling`} />
        <Stat label="Past due / lapsed" value={`${by("past_due")} / ${by("lapsed")}`} hint={`${by("canceled")} cancelled`} />
        <Stat label="Evidence to review" value={reviews.count ?? 0} tone={reviews.count ? "coral" : undefined} />
        <Stat label="Subscription revenue" value={<Money minor={sum("amount_minor")} />} hint="Recognised payments" />
        <Stat label="Allocated to charities" value={<Money minor={sum("charity_minor")} />} />
        <Stat label="Prize pool contributions" value={<Money minor={sum("pool_minor")} />} />
        <Stat label="Payouts awaiting transfer" value={<Money minor={(pendingPayouts.data ?? []).reduce((a, p) => a + Number(p.amount_minor), 0)} />} hint={`${pendingPayouts.data?.length ?? 0} payouts`} />
      </div>
      <Card><h2 className="text-lg font-bold">New activations by month</h2><p className="mb-3 text-xs text-muted">Subscriptions that became active (from status history), last six months.</p><TrendChart data={trend} label="Activations" />
        {trend.length > 0 && <table className="sr-only"><caption>Activations by month</caption><tbody>{trend.map((t) => <tr key={t.month}><th>{t.month}</th><td>{t.value}</td></tr>)}</tbody></table>}</Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><div className="flex items-center justify-between"><h2 className="text-lg font-bold">Recent draws</h2><Link className="text-sm font-semibold text-forest underline" href="/admin/draws">All</Link></div>
          {(draws.data ?? []).length === 0 ? <p className="mt-3 text-sm text-muted">No draws yet. <Link className="underline" href="/admin/draws/new">Create the first one</Link>.</p> : <ul className="mt-3 divide-y divide-line">{draws.data!.map((d) => <li key={d.id} className="flex items-center justify-between py-3 text-sm"><Link className="font-semibold hover:underline" href={`/admin/draws/${d.id}`}>{formatMonth(d.period_month)}</Link><StatusBadge status={d.status} /></li>)}</ul>}</Card>
        <Card><h2 className="text-lg font-bold">Summary</h2><p className="mt-3 text-sm leading-relaxed text-ink-2">{ai.text}</p><p className="mt-3 text-xs text-muted">{ai.source === "ai" ? "Written by AI from the figures above; every number is checked against them." : "Generated from the figures above (AI not configured)."}</p></Card>
      </div>
    </div>
  );
}
