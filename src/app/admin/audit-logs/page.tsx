import type { Metadata } from "next";
import { PageHeader, Pagination, Table } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Audit logs" };

export default async function AuditLogs({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const page = Math.max(Number.parseInt(sp.page ?? "1", 10) || 1, 1);
  const { data, count } = await createAdminClient().from("audit_logs").select("id, actor_id, actor_role, action, entity_type, entity_id, reason, created_at", { count: "exact" }).order("id", { ascending: false }).range((page - 1) * 50, page * 50 - 1);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Audit" title="An append-only" accent="record.">Admin actions are logged and cannot be edited or deleted.</PageHeader>
      <Table caption="Audit log" head={["When", "Action", "Entity", "Actor", "Reason"]}>{(data ?? []).map((a) => <tr key={a.id}><td>{formatDate(a.created_at, true)}</td><td className="font-mono text-xs">{a.action}</td><td>{a.entity_type}{a.entity_id ? ` · ${String(a.entity_id).slice(0, 8)}` : ""}</td><td className="font-mono text-xs">{a.actor_id ? String(a.actor_id).slice(0, 8) : "system"} {a.actor_role ?? ""}</td><td>{a.reason ?? "-"}</td></tr>)}</Table>
      <Pagination page={page} pageSize={50} total={count ?? 0} basePath="/admin/audit-logs" />
    </div>
  );
}
