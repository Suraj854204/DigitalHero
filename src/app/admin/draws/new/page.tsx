import { Card, PageHeader } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/session";
import { DrawForm } from "./draw-form";

export default async function NewDraw() {
  await requireAdminPage();
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return (<div className="space-y-6"><PageHeader eyebrow="Draws" title="Create a" accent="draw.">Tier shares and the unclaimed-money policy are copied from Settings at creation and then frozen at approval.</PageHeader><Card><DrawForm defaultMonth={month} defaultCutoff={lastDay} /></Card></div>);
}
