import type { Metadata } from "next";
import Link from "next/link";
import { Input, PageHeader, Pagination, Select, StatusBadge, Table } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/button-styles";
import { formatDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Users" };

export default async function Users({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const page = Math.max(Number.parseInt(sp.page ?? "1", 10) || 1, 1);
  const size = 20;
  const db = createAdminClient();
  let q = db.from("profiles").select("id, email, display_name, role, status, created_at, subscriptions(status, plan_id)", { count: "exact" });
  if (sp.q) q = q.or(`email.ilike.%${sp.q.replace(/[%_,()]/g, " ")}%,display_name.ilike.%${sp.q.replace(/[%_,()]/g, " ")}%`);
  if (sp.status) q = q.eq("status", sp.status);
  const { data, count } = await q.order("created_at", { ascending: false }).range((page - 1) * size, page * size - 1);
  type Row = { id: string; email: string; display_name: string | null; role: string; status: string; created_at: string; subscriptions: { status: string; plan_id: string }[] | { status: string; plan_id: string } | null };
  let rows = (data ?? []) as unknown as Row[];
  const subOf = (r: Row) => (Array.isArray(r.subscriptions) ? r.subscriptions[0] : r.subscriptions);
  if (sp.sub) rows = rows.filter((r) => (subOf(r)?.status ?? "none") === sp.sub);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Users" title="Everyone" accent="on the platform." />
      <form role="search" className="grid gap-3 rounded-[var(--radius-lg)] border border-line bg-card p-4 sm:grid-cols-[2fr_1fr_1fr_auto]">
        <div><label htmlFor="q" className="sr-only">Search</label><Input name="q" defaultValue={sp.q} placeholder="Email or name" /></div>
        <div><label htmlFor="status" className="sr-only">Account status</label><Select name="status" defaultValue={sp.status ?? ""}><option value="">Any account status</option><option value="active">Active</option><option value="suspended">Suspended</option></Select></div>
        <div><label htmlFor="sub" className="sr-only">Subscription</label><Select name="sub" defaultValue={sp.sub ?? ""}><option value="">Any subscription</option><option value="active">Active</option><option value="canceling">Cancelling</option><option value="past_due">Past due</option><option value="lapsed">Lapsed</option><option value="canceled">Cancelled</option><option value="none">None</option></Select></div>
        <button className={buttonClass("primary")}>Filter</button>
      </form>
      <Table caption="Users" head={["User", "Role", "Account", "Subscription", "Joined", ""]}>{rows.map((r) => (
        <tr key={r.id}><td><p className="font-semibold">{r.display_name ?? "-"}</p><p className="text-xs text-muted">{r.email}</p></td><td>{r.role}</td><td><StatusBadge status={r.status} /></td><td>{subOf(r) ? <StatusBadge status={subOf(r)!.status} /> : <span className="text-muted">none</span>}</td><td>{formatDate(r.created_at)}</td><td className="text-right"><Link className="font-semibold text-forest underline" href={`/admin/users/${r.id}`}>Open</Link></td></tr>))}</Table>
      {rows.length === 0 && <p className="text-sm text-muted">No users match.</p>}
      <Pagination page={page} pageSize={size} total={count ?? 0} basePath="/admin/users" params={{ q: sp.q, status: sp.status, sub: sp.sub }} />
    </div>
  );
}
