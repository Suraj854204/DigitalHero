import type { Metadata } from "next";
import { ContributionBreakdown } from "@/components/marketing/breakdown";
import { Card, LinkButton, PageHeader } from "@/components/ui/primitives";
import { getPlans, getPublicSettings } from "@/lib/data/public";

export const metadata: Metadata = { title: "How it works" };

export default async function HowItWorks() {
  const [settings, plans] = await Promise.all([getPublicSettings(), getPlans()]);
  const monthly = plans.find((p) => p.id === "monthly");
  const sections = [
    ["1. Subscribe and choose your charity", "Pick a monthly or yearly plan and the charity you want to support. Set your contribution anywhere from 10% to 100% of each payment. Your plan, price and renewal terms are shown before checkout."],
    ["2. Record your scores", "After each round, add your Stableford points (1 to 45) with the date played. You keep your five most recent scores, newest first. Adding a sixth removes the oldest. One score per date."],
    ["3. The monthly draw", "Each month an administrator runs the draw: five distinct numbers from 1 to 45. Only members with an active subscription and five valid scores at the eligibility cutoff take part, and their scores are frozen at that moment."],
    ["4. Matching and prizes", "We count how many of the five drawn numbers appear among your five frozen scores. Three, four or five matches win a share of that tier's prize. Winners in the same tier split it equally, to the paisa."],
    ["5. Claim and get paid", "Winners upload a screenshot of their scores. An administrator reviews it. Approved claims move to payout, and each payout is recorded with the transfer reference once it has been made."],
  ];
  return (
    <div className="mx-auto max-w-4xl px-5 py-14">
      <PageHeader eyebrow="How it works" title="Clear rules," accent="in plain language.">Everything that affects your money or your chances is written down here.</PageHeader>
      <ol className="space-y-5">{sections.map(([t, d]) => (<li key={t}><Card><h2 className="text-xl font-bold">{t}</h2><p className="mt-2 leading-relaxed text-ink-2">{d}</p></Card></li>))}</ol>
      <h2 className="mt-14 text-2xl font-bold">Where your payment goes</h2>
      <Card className="mt-5"><ContributionBreakdown amountMinor={monthly?.amount_minor ?? 99900} charityBps={settings.minCharityBps} poolBps={settings.prizePoolBps} label="Payment breakdown" /></Card>
      <h2 className="mt-14 text-2xl font-bold">Yearly plans</h2>
      <p className="mt-3 leading-relaxed text-ink-2">A yearly payment is held as deferred revenue and recognised in twelve equal monthly instalments (any leftover paise go to the earliest months). Each month's instalment is then split between your charity, the prize pool and the platform. This keeps the same money from ever being counted twice.</p>
      <div className="mt-10"><LinkButton href="/signup" variant="coral">Join Digital Heroes</LinkButton></div>
    </div>
  );
}
