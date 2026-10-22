import { Card, PageHeader } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/session";
import { CharityAdminForm } from "../charity-form";

export default async function NewCharity() {
  await requireAdminPage();
  return (<div className="space-y-6"><PageHeader eyebrow="Charities" title="Add a" accent="charity." /><Card><CharityAdminForm /></Card></div>);
}
