import Link from "next/link";
import { ContributionBreakdown } from "@/components/marketing/breakdown";
import { TierCards } from "@/components/marketing/tiers";
import { CharityArt } from "@/components/ui/charity-art";
import { Card, DemoBadge, LinkButton } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";
import { FAQ } from "@/content/faq";
import { getFeaturedCharity, getJackpotBalance, getPlans, getPublicSettings } from "@/lib/data/public";
import { formatMoney } from "@/lib/format";

const STEPS = [
  { n: "01", t: "Choose who you give to", d: "Pick a charity you care about and decide how much of your subscription goes to them. The minimum is 10%." },
  { n: "02", t: "Log your latest scores", d: "Add your Stableford points (1 to 45). We always keep your five most recent, newest first." },
  { n: "03", t: "Enter the monthly draw", d: "Five numbers are drawn each month. Three, four or five matches against your frozen scores win a share of the pool." },
  { n: "04", t: "See every rupee", d: "Your receipts, charity totals, draw results and payouts are all recorded in an auditable ledger you can read." },
];

export default async function Home() {
  const [featured, settings, plans, jackpot] = await Promise.all([getFeaturedCharity(), getPublicSettings(), getPlans(), getJackpotBalance()]);
  const monthly = plans.find((p) => p.id === "monthly");

  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-[34rem] rounded-full bg-mint/70 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -left-32 top-64 size-[26rem] rounded-full bg-coral-soft/70 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-14 lg:grid-cols-[1.15fr_0.85fr] lg:pb-28 lg:pt-24">
          <div>
            <p className="rise-in font-mono text-xs uppercase tracking-[0.2em] text-forest">Subscription · Monthly draw · Real giving</p>
            <h1 className="rise-in-2 mt-5 text-5xl font-bold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
              Your scores, <span className="serif-accent">their</span> future.
            </h1>
            <p className="rise-in-3 mt-6 max-w-xl text-lg leading-relaxed text-ink-2">
              Subscribe, choose a charity, and record your latest scores. A share of every payment goes to the cause you pick, and each month your scores enter a prize draw. Simple, open, and built around giving.
            </p>
            <div className="rise-in-3 mt-9 flex flex-wrap gap-3">
              <LinkButton href="/signup" variant="coral" size="lg">Join and choose your charity</LinkButton>
              <LinkButton href="/charities" variant="secondary" size="lg">Explore charities</LinkButton>
            </div>
            <p className="mt-6 max-w-lg text-sm text-muted">
              At least 10% of every subscription payment goes to your chosen charity.{monthly && <> Plans start at {formatMoney(monthly.amount_minor)} a month.</>} Prizes are never guaranteed.
            </p>
          </div>

          <div className="relative" aria-hidden={false}>
            <Card className="float-slow relative z-10 overflow-hidden p-0">
              <CharityArt slug="digital-heroes-hero" className="h-44 w-full" label="Abstract artwork" />
              <div className="p-6">
                <p className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-muted">Example · how a month can look</p>
                <p className="mt-3 text-sm text-ink-2">Your five latest scores</p>
                <ul className="mt-2 flex gap-2" aria-label="Example scores">
                  {[34, 28, 31, 22, 37].map((s) => (<li key={s} className="grid size-11 place-items-center rounded-full border border-line bg-paper text-sm font-bold tabular-nums">{s}</li>))}
                </ul>
                <p className="mt-5 text-sm text-ink-2">Numbers drawn this month</p>
                <ul className="mt-2 flex gap-2" aria-label="Example drawn numbers">
                  {[7, 22, 31, 38, 41].map((s) => (<li key={s} className={`grid size-11 place-items-center rounded-full text-sm font-bold tabular-nums ${[22, 31].includes(s) ? "bg-forest text-white" : "bg-paper-2"}`}>{s}</li>))}
                </ul>
                <p className="mt-5 rounded-xl bg-mint/60 px-3 py-2 text-sm text-forest-2">Two matches here. Three or more would win a prize. This is an illustration, not a result.</p>
              </div>
            </Card>
            <div aria-hidden className="absolute -bottom-6 -left-6 size-40 rounded-full bg-coral/90 mix-blend-multiply" />
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="mx-auto max-w-6xl px-5 py-16" aria-labelledby="how">
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-forest">How it works</p>
          <h2 id="how" className="mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">Four steps, nothing hidden <span className="serif-accent">along the way.</span></h2>
        </Reveal>
        <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.08}>
              <li className="card-lift h-full rounded-[var(--radius-lg)] border border-line bg-card p-6 shadow-soft">
                <span className="font-mono text-sm text-coral">{s.n}</span>
                <h3 className="mt-4 text-lg font-bold">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{s.d}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* CHARITY IMPACT + TRANSPARENT SPLIT */}
      <section className="bg-forest text-white" aria-labelledby="impact">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-2 lg:items-center">
          <Reveal>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-mint">Giving, built in</p>
            <h2 id="impact" className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">The charity comes first, <span className="font-serif font-normal italic text-coral-soft">not last.</span></h2>
            <p className="mt-5 max-w-lg leading-relaxed text-white/85">
              Your contribution is set when you join and can go well above the 10% minimum. Each payment is recorded in a ledger, so what reaches your charity is a figure we can show, not a promise.
            </p>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-white/70">We only publish impact figures that charities have verified with us. Where none exist yet, we say so rather than invent them.</p>
            <div className="mt-8"><LinkButton href="/charities" variant="coral">Meet the charities</LinkButton></div>
          </Reveal>
          <Reveal delay={0.1}>
            <Card className="text-ink">
              <ContributionBreakdown amountMinor={monthly?.amount_minor ?? 99900} charityBps={settings.minCharityBps} poolBps={settings.prizePoolBps} label="Where a subscription payment goes" />
            </Card>
          </Reveal>
        </div>
      </section>

      {/* FEATURED CHARITY */}
      {featured && (
        <section className="mx-auto max-w-6xl px-5 py-20" aria-labelledby="spotlight">
          <Reveal>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-forest">Charity spotlight</p>
            <h2 id="spotlight" className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Featured <span className="serif-accent">this month</span></h2>
          </Reveal>
          <Reveal delay={0.1}>
            <Card className="card-lift mt-8 grid overflow-hidden p-0 md:grid-cols-[1fr_1.1fr]">
              <CharityArt slug={featured.slug} className="h-56 w-full md:h-full" label={featured.image_alt ?? `Artwork for ${featured.name}`} />
              <div className="p-8">
                <div className="flex flex-wrap items-center gap-2">
                  {featured.category && <span className="rounded-full bg-mint px-3 py-1 text-xs font-semibold text-forest-2">{featured.category}</span>}
                  {featured.is_demo && <DemoBadge label="Demo charity" />}
                </div>
                <h3 className="mt-4 text-2xl font-bold">{featured.name}</h3>
                <p className="mt-3 leading-relaxed text-ink-2">{featured.short_description}</p>
                <Link href={`/charities/${featured.slug}`} className="mt-6 inline-block font-semibold text-forest underline underline-offset-4 hover:text-forest-2">Read the full profile →</Link>
              </div>
            </Card>
          </Reveal>
        </section>
      )}

      {/* DRAW MECHANICS */}
      <section className="mx-auto max-w-6xl px-5 py-16" aria-labelledby="draw">
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-forest">The monthly draw</p>
          <h2 id="draw" className="mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">Three ways to win, <span className="serif-accent">one fair process.</span></h2>
          <p className="mt-4 max-w-2xl text-ink-2">Five numbers from 1 to 45 are drawn once a month. We compare them with your five frozen scores. Prize shares are fixed in advance and published below.</p>
        </Reveal>
        <div className="mt-10"><TierCards cfg={settings.tierConfig} /></div>
        {jackpot > 0 && (
          <p className="mt-6 rounded-[var(--radius-md)] bg-coral-soft px-5 py-4 text-sm"><strong>Current jackpot carried over:</strong> {formatMoney(jackpot)} from previous draws, added to the next five-match prize.</p>
        )}
        <p className="mt-6 text-sm text-muted">Prizes are never guaranteed. <Link className="underline" href="/prizes">Read the full draw rules</Link>.</p>
      </section>

      {/* TRUST */}
      <section className="mx-auto max-w-6xl px-5 py-16" aria-labelledby="trust">
        <Reveal><h2 id="trust" className="text-3xl font-bold tracking-tight sm:text-4xl">Built so you can <span className="serif-accent">check our work.</span></h2></Reveal>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {[
            ["Frozen scores", "When a draw is approved, every participant's five scores are locked. Nobody, including us, can edit them afterwards."],
            ["An auditable ledger", "Every payment, charity share, prize and payout is a balanced ledger entry. Reports reconcile to it, not to a separate total."],
            ["Human-verified payouts", "Winners upload proof, an administrator reviews it, and each payout gets a recorded transfer reference."],
          ].map(([t, d], i) => (
            <Reveal key={t} delay={i * 0.08}><Card className="h-full"><h3 className="text-lg font-bold">{t}</h3><p className="mt-2 text-sm leading-relaxed text-ink-2">{d}</p></Card></Reveal>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-5 py-16" aria-labelledby="faq">
        <h2 id="faq" className="text-3xl font-bold tracking-tight sm:text-4xl">Questions, <span className="serif-accent">answered.</span></h2>
        <div className="mt-8 divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-card">
          {FAQ.slice(0, 5).map((f) => (
            <details key={f.q} className="group px-6 py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">{f.q}<span aria-hidden className="text-xl text-forest transition group-open:rotate-45">+</span></summary>
              <p className="mt-3 leading-relaxed text-ink-2">{f.a}</p>
            </details>
          ))}
        </div>
        <p className="mt-5 text-sm"><Link className="font-semibold text-forest underline underline-offset-4" href="/faq">See all questions</Link></p>
      </section>

      {/* FINAL CTA */}
      <section className="mx-auto max-w-6xl px-5 pb-8">
        <div className="relative overflow-hidden rounded-[2rem] bg-ink px-8 py-16 text-center text-white sm:px-16">
          <div aria-hidden className="absolute -right-10 -top-10 size-56 rounded-full bg-coral/80" />
          <div aria-hidden className="absolute -bottom-16 -left-10 size-64 rounded-full bg-forest" />
          <div className="relative">
            <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl">Ready to make your next round <span className="font-serif font-normal italic text-coral-soft">count?</span></h2>
            <p className="mx-auto mt-4 max-w-xl text-white/80">Join, choose your charity, and see exactly where your money goes from day one.</p>
            <div className="mt-8"><LinkButton href="/signup" variant="coral" size="lg">Join Digital Heroes</LinkButton></div>
          </div>
        </div>
      </section>
    </>
  );
}
