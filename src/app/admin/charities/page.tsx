import type { Metadata } from "next";
import Link from "next/link";
import { archiveCharity } from "@/app/actions/admin";
import { ConfirmForm } from "@/components/ui/confirm";
import { Badge, DemoBadge, LinkButton, PageHeader, StatusBadge, Table } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Charities" };

export default async function AdminCharities() {
  await requireAdminPage();
  const db = createAdminClient();
  const { data } = await db.from("charities").select("id, name, slug, category, status, is_featured, is_demo").order("status").order("name");
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Charities" title="Manage the" accent="directory." actions={<LinkButton href="/admin/charities/new" variant="coral" size="sm">Add charity</LinkButton>}>We don't mark any charity as verified or accredited here. Only publish information you have confirmed.</PageHeader>
      <Table caption="Charities" head={["Name", "Category", "Status", "Flags", ""]}>{(data ?? []).map((c) => (
        <tr key={c.id}><td><Link className="font-semibold hover:underline" href={`/admin/charities/${c.id}`}>{c.name}</Link><p className="text-xs text-muted">/{c.slug}</p></td><td>{c.category ?? "-"}</td><td><StatusBadge status={c.status} /></td><td className="space-x-1">{c.is_featured && <Badge tone="coral">Featured</Badge>}{c.is_demo && <DemoBadge label="Demo" />}</td>
          <td className="text-right"><ConfirmForm action={archiveCharity} trigger={c.status === "archived" ? "Restore" : "Archive"} triggerVariant="ghost" title={c.status === "archived" ? "Restore this charity?" : "Archive this charity?"} confirmLabel={c.status === "archived" ? "Restore" : "Archive"} variant={c.status === "archived" ? "primary" : "danger"} description={c.status === "archived" ? "It will be visible and selectable again." : "It disappears from the public directory and can't be newly selected. Members' past contributions stay attached to it."}><input type="hidden" name="id" value={c.id} />{c.status === "archived" && <input type="hidden" name="restore" value="true" />}</ConfirmForm></td></tr>))}</Table>
    </div>
  );
}
