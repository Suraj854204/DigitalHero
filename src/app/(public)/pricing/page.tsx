import type { Metadata } from "next";
import { Card, LinkButton, Money, PageHeader } from "@/components/ui/primitives";
import { ContributionBreakdown } from "@/components/marketing/breakdown";
import { getPlans, getPublicSettings } from "@/lib/data/public";
import { formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Pricing" };

export default async function Pricing() {
  const [plans, settings] = await Promise.all([getPlans(), getPublicSettings()]);
  const monthly = plans.find((p) => p.id === "monthly");
  const yearly = plans.find((p) => p.id === "yearly");
  const saving = monthly && yearly ? monthly.amount_minor * 12 - yearly.amount_minor : 0;
  return (
    <div className="mx-auto max-w-5xl px-5 py-14">
      <PageHeader eyebrow="Pricing" title="Simple pricing," accent="visible splits.">Choose a plan. You'll see the exact price, charity amount and renewal terms before you pay.</PageHeader>
      <div className="grid gap-6 md:grid-cols-2">
        {[monthly, yearly].filter(Boolean).map((p) => (
          <Card key={p!.id} className={p!.id === "yearly" ? "border-forest/40 ring-2 ring-mint" : ""}>
            <h2 className="text-xl font-bold">{p!.name}</h2>
            <p className="mt-4 text-5xl font-bold tracking-tight"><Money minor={p!.amount_minor} /><span className="text-base font-medium text-muted"> / {p!.interval}</span></p>
            {p!.id === "yearly" && saving > 0 && <p className="mt-2 text-sm font-semibold text-forest">Saves {formatMoney(saving)} compared with paying monthly.</p>}
            <ul className="mt-5 space-y-2 text-sm text-ink-2"><li>✓ At least 10% to your chosen charity</li><li>✓ Entry to every monthly draw while eligible</li><li>✓ Full contribution and payout history</li><li>✓ Cancel any time; access runs to the end of the paid period</li></ul>
            <div className="mt-6"><LinkButton href={`/signup?plan=${p!.id}`} variant={p!.id === "yearly" ? "coral" : "primary"} className="w-full">Choose {p!.name.toLowerCase()}</LinkButton></div>
          </Card>
        ))}
      </div>
      <Card className="mt-10"><h2 className="mb-4 text-xl font-bold">What each payment funds</h2>
        <ContributionBreakdown amountMinor={monthly?.amount_minor ?? 99900} charityBps={settings.minCharityBps} poolBps={settings.prizePoolBps} label="Payment breakdown" /></Card>
      <p className="mt-8 text-sm leading-relaxed text-muted">Subscriptions renew automatically until cancelled. Payments are processed by Stripe. Prices include applicable taxes unless stated at checkout. You can cancel from your billing page and keep access until the period ends. Refunds follow our <a className="underline" href="/terms">terms</a>.</p>
    </div>
  );
}
