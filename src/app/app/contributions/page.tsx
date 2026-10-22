import type { Metadata } from "next";
import { Badge, EmptyState, Money, PageHeader, Stat, Table } from "@/components/ui/primitives";
import { getMyContributions } from "@/lib/data/subscriber";
import { bpsToPercent, formatDate } from "@/lib/format";
import { requireUserPage } from "@/lib/session";

export const metadata: Metadata = { title: "Contributions" };

const KIND: Record<string, string> = { subscription_monthly: "Monthly payment", subscription_annual_installment: "Yearly plan instalment", donation: "Donation" };

export default async function Contributions() {
  await requireUserPage();
  const rows = await getMyContributions();
  const total = rows.reduce((a, r) => a + Number(r.charity_minor), 0);
  const pool = rows.reduce((a, r) => a + Number(r.pool_minor), 0);
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Contributions" title="Where your money" accent="went.">Every row is a recorded ledger entry. We only count a contribution once the payment behind it is confirmed.</PageHeader>
      <div className="grid gap-4 sm:grid-cols-3"><Stat label="To your charities" value={<Money minor={total} />} tone="coral" hint="Recorded allocation" /><Stat label="Into the prize pool" value={<Money minor={pool} />} /><Stat label="Entries" value={rows.length} /></div>
      {rows.length === 0 ? <EmptyState title="No contributions yet">Contributions appear here after your first payment is confirmed.</EmptyState> : (
        <Table caption="Contribution history" head={["Date", "Type", "Charity", "Payment", "To charity", "Share"]}>
          {rows.map((r) => (<tr key={r.id}><td>{formatDate(r.recognized_at)}</td><td>{KIND[r.kind] ?? r.kind}</td><td>{r.charities?.name ?? "-"}</td><td><Money minor={r.amount_minor} /></td><td className="font-semibold text-coral"><Money minor={r.charity_minor} /></td><td><Badge>{bpsToPercent(r.charity_bps)}</Badge></td></tr>))}
        </Table>)}
      <p className="text-xs text-muted">"To charity" is the amount allocated to the charity in our ledger. Transfers to charities are made periodically; allocation is not itself a transfer.</p>
    </div>
  );
}
