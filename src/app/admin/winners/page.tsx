import type { Metadata } from "next";
import Link from "next/link";
import { Money, PageHeader, Pagination, Select, StatusBadge, Table } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/button-styles";
import { formatDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Winners" };

export default async function Winners({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const page = Math.max(Number.parseInt(sp.page ?? "1", 10) || 1, 1);
  let q = createAdminClient().from("winnings").select("id, tier, amount_minor, claim_status, created_at, profiles(email, display_name), draws(title)", { count: "exact" });
  if (sp.status) q = q.eq("claim_status", sp.status);
  const { data, count } = await q.order("created_at", { ascending: false }).range((page - 1) * 25, page * 25 - 1);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Winners" title="Verify and" accent="track claims.">Evidence in review comes first.</PageHeader>
      <form className="flex gap-3"><label htmlFor="status" className="sr-only">Status</label><div className="w-60"><Select name="status" defaultValue={sp.status ?? ""}><option value="">All claims</option>{["pending_review", "approved", "payout_pending", "paid", "rejected", "not_submitted"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</Select></div><button className={buttonClass("primary")}>Filter</button></form>
      <Table caption="Winnings" head={["Winner", "Draw", "Tier", "Prize", "Claim", "Won", ""]}>{((data ?? []) as unknown as { id: string; tier: number; amount_minor: number; claim_status: string; created_at: string; profiles: { email: string; display_name: string | null } | null; draws: { title: string } | null }[]).map((w) => (
        <tr key={w.id}><td>{w.profiles?.display_name ?? w.profiles?.email}</td><td>{w.draws?.title}</td><td>{w.tier}</td><td><Money minor={w.amount_minor} /></td><td><StatusBadge status={w.claim_status} /></td><td>{formatDate(w.created_at)}</td><td className="text-right"><Link className="font-semibold text-forest underline" href={`/admin/winners/${w.id}`}>{w.claim_status === "pending_review" ? "Review" : "Open"}</Link></td></tr>))}</Table>
      <Pagination page={page} pageSize={25} total={count ?? 0} basePath="/admin/winners" params={{ status: sp.status }} />
    </div>
  );
}
