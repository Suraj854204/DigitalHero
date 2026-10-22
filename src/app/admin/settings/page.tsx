import type { Metadata } from "next";
import { Alert, PageHeader } from "@/components/ui/primitives";
import { requireAdminPage } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function Settings() {
  await requireAdminPage();
  const db = createAdminClient();
  const [{ data: rows }, { data: plans }] = await Promise.all([db.from("app_settings").select("key, value"), db.from("plans").select("id, amount_minor")]);
  const s = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value]));
  const t = s.tier_config as { shareBps: Record<string, number>; unclaimedPolicy: "reserve" | "jackpot" };
  const price = (id: string) => Math.round(Number(plans?.find((p) => p.id === id)?.amount_minor ?? 0) / 100);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Settings" title="Money rules," accent="in one place.">Every change is audited.</PageHeader>
      {!s.prize_pool_confirmed && <Alert tone="warn">The prize pool percentage is an unconfirmed assumption. Confirm it with the client, then tick the box below.</Alert>}
      <Alert tone="info">Price changes apply to new checkouts only. Update the matching Stripe Price IDs in your environment when prices change. The minimum charity share is {Number(s.min_charity_bps) / 100}% and is enforced by the database.</Alert>
      <SettingsForm v={{ prizePoolBps: Number(s.prize_pool_bps), confirmed: !!s.prize_pool_confirmed, s5: t.shareBps["5"], s4: t.shareBps["4"], s3: t.shareBps["3"], unclaimedPolicy: t.unclaimedPolicy, monthlyPrice: price("monthly"), yearlyPrice: price("yearly") }} />
    </div>
  );
}
