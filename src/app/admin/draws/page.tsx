import type { Metadata } from "next";
import Link from "next/link";
import { LinkButton, EmptyState, Money, PageHeader, StatusBadge, Table } from "@/components/ui/primitives";
import { formatDate, formatMonth } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Draws" };

export default async function AdminDraws() {
  await requireAdminPage();
  const { data } = await createAdminClient().from("draws").select("id, title, period_month, status, mode, participant_count, pool_minor, published_at").order("period_month", { ascending: false });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Draws" title="Configure," accent="simulate, publish." actions={<LinkButton href="/admin/draws/new" variant="coral" size="sm">New draw</LinkButton>}>A draw moves draft → simulated → approved → published. Only publishing creates winnings and ledger entries.</PageHeader>
      {(data ?? []).length === 0 ? <EmptyState title="No draws yet" action={<LinkButton href="/admin/draws/new" size="sm">Create the first draw</LinkButton>}>Create a draw for a month, set its eligibility cutoff, and simulate it before approving.</EmptyState> : (
        <Table caption="Draws" head={["Month", "Mode", "Status", "Participants", "Pool", "Published"]}>{data!.map((d) => (
          <tr key={d.id}><td><Link className="font-semibold hover:underline" href={`/admin/draws/${d.id}`}>{formatMonth(d.period_month)}</Link><p className="text-xs text-muted">{d.title}</p></td><td>{d.mode}</td><td><StatusBadge status={d.status} /></td><td>{d.participant_count ?? "-"}</td><td>{d.pool_minor === null ? "-" : <Money minor={d.pool_minor} />}</td><td>{formatDate(d.published_at)}</td></tr>))}</Table>)}
    </div>
  );
}
