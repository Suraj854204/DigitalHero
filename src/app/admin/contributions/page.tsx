import type { Metadata } from "next";
import { Money, PageHeader, Pagination, Stat, Table } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Contributions" };

export default async function Contributions({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const page = Math.max(Number.parseInt(sp.page ?? "1", 10) || 1, 1);
  const db = createAdminClient();
  const [{ data, count }, { data: totals }] = await Promise.all([
    db.from("contributions").select("id, kind, amount_minor, charity_minor, pool_minor, platform_minor, charity_bps, recognized_at, charities(name), profiles(email)", { count: "exact" }).order("recognized_at", { ascending: false }).range((page - 1) * 25, page * 25 - 1),
    db.from("contributions").select("amount_minor, charity_minor, pool_minor, platform_minor").limit(100000),
  ]);
  const sum = (k: "amount_minor" | "charity_minor" | "pool_minor" | "platform_minor") => (totals ?? []).reduce((a, r) => a + Number(r[k]), 0);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Contributions" title="Where every rupee" accent="was allocated.">Recognised revenue only. Annual plans appear as monthly instalments.</PageHeader>
      <div className="grid gap-4 sm:grid-cols-4"><Stat label="Recognised" value={<Money minor={sum("amount_minor")} />} /><Stat label="To charities" value={<Money minor={sum("charity_minor")} />} tone="coral" /><Stat label="To prize pool" value={<Money minor={sum("pool_minor")} />} /><Stat label="Platform" value={<Money minor={sum("platform_minor")} />} /></div>
      <Table caption="Contributions" head={["Recognised", "Member", "Charity", "Type", "Amount", "Charity", "Pool", "Platform"]}>{((data ?? []) as unknown as { id: string; kind: string; amount_minor: number; charity_minor: number; pool_minor: number; platform_minor: number; recognized_at: string; charities: { name: string } | null; profiles: { email: string } | null }[]).map((c) => (
        <tr key={c.id}><td>{formatDate(c.recognized_at)}</td><td>{c.profiles?.email}</td><td>{c.charities?.name ?? "-"}</td><td>{c.kind.replaceAll("_", " ")}</td><td><Money minor={c.amount_minor} /></td><td><Money minor={c.charity_minor} /></td><td><Money minor={c.pool_minor} /></td><td><Money minor={c.platform_minor} /></td></tr>))}</Table>
      <Pagination page={page} pageSize={25} total={count ?? 0} basePath="/admin/contributions" />
    </div>
  );
}
