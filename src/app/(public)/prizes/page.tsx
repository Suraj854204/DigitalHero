import type { Metadata } from "next";
import { TierCards } from "@/components/marketing/tiers";
import { Card, EmptyState, LinkButton, Money, PageHeader } from "@/components/ui/primitives";
import { getJackpotBalance, getPublicSettings, getPublishedDraws } from "@/lib/data/public";
import { bpsToPercent, formatMonth } from "@/lib/format";

export const metadata: Metadata = { title: "Prizes & draws" };

export default async function Prizes() {
  const [settings, draws, jackpot] = await Promise.all([getPublicSettings(), getPublishedDraws(12), getJackpotBalance()]);
  return (
    <div className="mx-auto max-w-5xl px-5 py-14">
      <PageHeader eyebrow="Prizes & draws" title="How prizes" accent="are decided.">Prize shares, rollover and results are published here. Prizes are never guaranteed.</PageHeader>
      <TierCards cfg={settings.tierConfig} />
      <Card className="mt-8">
        <h2 className="text-xl font-bold">The rules</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed text-ink-2">
          <li>The prize pool is {bpsToPercent(settings.prizePoolBps)} of each recognised subscription payment.</li>
          <li>Five distinct numbers from 1 to 45 are drawn once a month. A published draw can never be re-run.</li>
          <li>You are eligible with an active subscription and five valid scores at the eligibility cutoff. Your scores are frozen then.</li>
          <li>A winning number counts once, even if you scored the same value twice.</li>
          <li>Winners in a tier share it equally. Any indivisible paise are allocated one at a time, so nothing is lost to rounding.</li>
          <li>If nobody matches five numbers, that tier's money rolls over into the next jackpot. Unclaimed four- and three-match money is held in a separate, visible reserve.</li>
          <li>Winners verify with a score screenshot before payout.</li>
        </ul>
        <p className="mt-5 rounded-xl bg-coral-soft px-4 py-3 text-sm"><strong>Jackpot carried over right now:</strong> <Money minor={jackpot} /></p>
      </Card>
      <h2 className="mt-14 text-2xl font-bold">Past results</h2>
      {draws.length === 0 ? <div className="mt-5"><EmptyState title="No draws published yet">The first published draw will appear here with its winning numbers and prize allocation.</EmptyState></div> : (
        <ul className="mt-5 grid gap-4 sm:grid-cols-2">{draws.map((d) => (
          <li key={d.id}><Card><p className="font-mono text-xs uppercase tracking-widest text-muted">{formatMonth(d.period_month)}</p>
            <ul className="mt-3 flex gap-2" aria-label="Winning numbers">{d.winning_numbers.map((n) => <li key={n} className="grid size-11 place-items-center rounded-full bg-forest font-bold text-white tabular-nums">{n}</li>)}</ul>
            <p className="mt-3 text-sm text-muted">{d.participant_count ?? 0} participants</p></Card></li>))}</ul>
      )}
      <div className="mt-10"><LinkButton href="/signup" variant="coral">Join the next draw</LinkButton></div>
    </div>
  );
}
