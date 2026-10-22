import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { CharityAdminForm } from "../charity-form";

export default async function EditCharity({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminPage();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = createAdminClient();
  const { data } = await db.from("charities").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  return (<div className="space-y-6"><Link href="/admin/charities" className="text-sm font-semibold text-forest underline underline-offset-4">← Charities</Link><PageHeader eyebrow="Charities" title={data.name} accent="" /><Card><CharityAdminForm v={data} /></Card></div>);
}
