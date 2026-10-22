import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, EmptyState, Money, PageHeader, Stat, StatusBadge, Table } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { PayoutForm } from "./payout-form";

export const metadata: Metadata = { title: "Payouts" };

export default async function Payouts() {
  await requireAdminPage();
  const db = createAdminClient();
  const [{ data: pending }, { data: paid }, { data: recon }] = await Promise.all([
    db.from("payouts").select("id, winning_id, amount_minor, queued_at, winnings(tier, profiles(email, display_name))").eq("status", "pending").order("queued_at"),
    db.from("payouts").select("id, winning_id, amount_minor, reference, method, paid_at").eq("status", "paid").order("paid_at", { ascending: false }).limit(50),
    db.from("v_reconciliation").select("check_name, ledger_minor, source_minor").eq("check_name", "prize_payable = unpaid winnings"),
  ]);
  const pendingTotal = (pending ?? []).reduce((a, p) => a + Number(p.amount_minor), 0);
  const paidTotal = (paid ?? []).reduce((a, p) => a + Number(p.amount_minor), 0);
  const r = recon?.[0];
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Payouts" title="Queue," accent="transfer, record.">Marking a payout paid records that you made an external transfer. This platform does not move money itself.</PageHeader>
      <div className="grid gap-4 sm:grid-cols-3"><Stat label="Awaiting transfer" value={<Money minor={pendingTotal} />} hint={`${pending?.length ?? 0} payouts`} tone={pending?.length ? "coral" : undefined} /><Stat label="Paid (last 50)" value={<Money minor={paidTotal} />} /><Stat label="Reconciliation" value={r && Number(r.ledger_minor) === Number(r.source_minor) ? "Balanced" : "MISMATCH"} hint="Ledger prize payable vs unpaid winnings" /></div>
      {r && Number(r.ledger_minor) !== Number(r.source_minor) && <Alert tone="error">Prize-payable in the ledger (<Money minor={r.ledger_minor} />) doesn't match unpaid winnings (<Money minor={r.source_minor} />). Investigate before paying anyone.</Alert>}
      <section><h2 className="mb-3 text-lg font-bold">Awaiting transfer</h2>
        {(pending ?? []).length === 0 ? <EmptyState title="Nothing waiting">Approved claims you queue for payout will appear here.</EmptyState> : <div className="space-y-4">{((pending ?? []) as unknown as { id: string; winning_id: string; amount_minor: number; queued_at: string; winnings: { tier: number; profiles: { email: string; display_name: string | null } } }[]).map((p) => (
          <Card key={p.id}><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">{p.winnings.profiles.display_name ?? p.winnings.profiles.email}</p><p className="text-xs text-muted">{p.winnings.tier} matches · queued {formatDate(p.queued_at)}</p></div><p className="text-xl font-bold"><Money minor={p.amount_minor} /></p></div><PayoutForm winningId={p.winning_id} /></Card>))}</div>}
      </section>
      <section><h2 className="mb-3 text-lg font-bold">Payout history</h2>
        <Table caption="Paid payouts" head={["Paid", "Amount", "Reference", "Method", ""]}>{(paid ?? []).map((p) => <tr key={p.id}><td>{formatDate(p.paid_at, true)}</td><td><Money minor={p.amount_minor} /></td><td className="font-mono">{p.reference}</td><td>{p.method ?? "-"}</td><td className="text-right"><Link className="font-semibold text-forest underline" href={`/admin/winners/${p.winning_id}`}>Open</Link></td></tr>)}</Table>
        {(paid ?? []).length === 0 && <p className="mt-3 text-sm text-muted">No payouts recorded yet.</p>}</section>
    </div>
  );
}
