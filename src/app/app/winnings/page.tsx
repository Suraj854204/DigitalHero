import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, Money, PageHeader, Stat, StatusBadge, Table } from "@/components/ui/primitives";
import { getMyWinnings } from "@/lib/data/subscriber";
import { formatMonth } from "@/lib/format";
import { requireUserPage } from "@/lib/session";

export const metadata: Metadata = { title: "Winnings" };

export default async function Winnings() {
  await requireUserPage();
  const rows = await getMyWinnings();
  const total = rows.reduce((a, r) => a + Number(r.amount_minor), 0);
  const paid = rows.filter((r) => r.claim_status === "paid").reduce((a, r) => a + Number(r.amount_minor), 0);
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Winnings" title="Your prizes" accent="and payouts.">Upload proof for each prize. Once approved, we queue and record your payout.</PageHeader>
      <div className="grid gap-4 sm:grid-cols-3"><Stat label="Total won" value={<Money minor={total} />} /><Stat label="Paid out" value={<Money minor={paid} />} /><Stat label="Prizes" value={rows.length} /></div>
      {rows.length === 0 ? <EmptyState title="No winnings yet">Match three or more numbers in a monthly draw and your prize will show up here.</EmptyState> : (
        <Table caption="Winnings" head={["Draw", "Tier", "Prize", "Status", ""]}>{rows.map((w) => (
          <tr key={w.id}><td>{w.draws ? formatMonth(w.draws.period_month) : "-"}</td><td>{w.tier} matches</td><td className="font-semibold"><Money minor={w.amount_minor} /></td><td><StatusBadge status={w.claim_status} /></td><td className="text-right"><Link className="font-semibold text-forest underline underline-offset-4" href={`/app/winnings/${w.id}`}>{w.claim_status === "not_submitted" || w.claim_status === "rejected" ? "Submit proof" : "View"}</Link></td></tr>))}</Table>)}
    </div>
  );
}
