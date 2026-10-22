import type { Metadata } from "next";
import Link from "next/link";
import { Money, PageHeader, Pagination, Select, StatusBadge, Table } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/button-styles";
import { formatDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Subscriptions" };

export default async function Subscriptions({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const page = Math.max(Number.parseInt(sp.page ?? "1", 10) || 1, 1);
  const db = createAdminClient();
  let q = db.from("subscriptions").select("id, user_id, plan_id, status, current_period_end, cancel_at_period_end, profiles(email, display_name)", { count: "exact" });
  if (sp.status) q = q.eq("status", sp.status);
  const { data, count } = await q.order("updated_at", { ascending: false }).range((page - 1) * 25, page * 25 - 1);
  const { data: plans } = await db.from("plans").select("id, amount_minor");
  const price = new Map((plans ?? []).map((p) => [p.id, p.amount_minor]));
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Subscriptions" title="Every" accent="subscription.">Status changes only arrive from verified Stripe events. There is no manual activation.</PageHeader>
      <form className="flex gap-3"><label htmlFor="status" className="sr-only">Status</label><div className="w-56"><Select name="status" defaultValue={sp.status ?? ""}><option value="">All statuses</option>{["active", "canceling", "past_due", "lapsed", "canceled", "incomplete"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</Select></div><button className={buttonClass("primary")}>Filter</button></form>
      <Table caption="Subscriptions" head={["Member", "Plan", "Status", "Period end", "Price"]}>{((data ?? []) as unknown as { id: string; user_id: string; plan_id: string; status: string; current_period_end: string | null; cancel_at_period_end: boolean; profiles: { email: string; display_name: string | null } | null }[]).map((s) => (
        <tr key={s.id}><td><Link className="font-semibold hover:underline" href={`/admin/users/${s.user_id}`}>{s.profiles?.display_name ?? s.profiles?.email}</Link></td><td>{s.plan_id}</td><td><StatusBadge status={s.status} /></td><td>{formatDate(s.current_period_end)}{s.cancel_at_period_end ? " (ends)" : ""}</td><td><Money minor={price.get(s.plan_id)} /></td></tr>))}</Table>
      <Pagination page={page} pageSize={25} total={count ?? 0} basePath="/admin/subscriptions" params={{ status: sp.status }} />
    </div>
  );
}
