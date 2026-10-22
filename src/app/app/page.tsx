import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, Card, EmptyState, LinkButton, Money, PageHeader, Stat, StatusBadge } from "@/components/ui/primitives";
import { getCharityEvents, getPublishedDraws } from "@/lib/data/public";
import { getMyCharitySelection, getMyContributions, getMyScores, getMySubscription, getMyWinnings, myEligibility } from "@/lib/data/subscriber";
import { bpsToPercent, formatDate, formatMonth } from "@/lib/format";
import { requireUserPage } from "@/lib/session";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { profile, actor } = await requireUserPage();
  const supabase = await createUserClient();
  const [sub, scores, selection, contributions, winnings, draws] = await Promise.all([getMySubscription(), getMyScores(), getMyCharitySelection(), getMyContributions(), getMyWinnings(), getPublishedDraws(1)]);
  const eligibility = myEligibility(actor.id, sub, scores);
  const charityTotal = contributions.reduce((a, c) => a + Number(c.charity_minor), 0);
  const latest = draws[0];
  const myMatch = latest ? (await supabase.from("draw_matches").select("match_count, tier").eq("draw_id", latest.id).maybeSingle()).data : null;
  const events = selection?.charities ? await getCharityEvents(selection.charities.id) : [];
  const { data: notes } = await supabase.from("notifications").select("id, title, body, created_at").is("read_at", null).order("created_at", { ascending: false }).limit(3);
  const unpaid = winnings.filter((w) => w.claim_status !== "paid");
  const active = sub && ["active", "canceling"].includes(sub.status);

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Dashboard" title={`Hello, ${profile.display_name?.split(" ")[0] ?? "friend"}`} accent="here's your month.">Everything here comes from your real account records.</PageHeader>

      {sp.checkout === "success" && !active && <Alert tone="info">Thanks! We're waiting for Stripe to confirm your payment. This usually takes a few seconds; refresh to check. Your subscription is activated only once the payment is confirmed.</Alert>}
      {!sub && <Alert tone="warn">You don't have a subscription yet. <Link className="font-semibold underline" href="/onboarding">Choose a charity and plan</Link> to join the draw.</Alert>}
      {sub?.status === "past_due" && <Alert tone="error">Your last payment didn't go through. <Link className="font-semibold underline" href="/app/billing">Update your payment method</Link> to stay in the draw.</Alert>}
      {sub?.status === "lapsed" && <Alert tone="error">Your subscription has lapsed. <Link className="font-semibold underline" href="/app/billing">Renew</Link> to re-enter the draw.</Alert>}
      {sub?.status === "canceling" && <Alert tone="warn">Your subscription ends on {formatDate(sub.current_period_end)}. <Link className="font-semibold underline" href="/app/billing">Keep it</Link>.</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Subscription" value={sub ? <StatusBadge status={sub.status} /> : "None"} hint={sub?.current_period_end ? `Renews/ends ${formatDate(sub.current_period_end)}` : undefined} />
        <Stat label="Scores recorded" value={`${scores.length}/5`} hint={eligibility.eligible ? "Eligible for the next draw" : "Need 5 for the draw"} />
        <Stat label="Given to charity" value={<Money minor={charityTotal} />} hint="From recorded payments" tone="coral" />
        <Stat label="Prizes won" value={winnings.length} hint={unpaid.length ? `${unpaid.length} in progress` : undefined} />
      </div>

      <Card className={eligibility.eligible ? "border-forest/40 bg-mint/40" : "border-gold/50 bg-[#fbf3dc]"}>
        <p className="font-semibold">{eligibility.eligible ? "✓ " : ""}Next draw eligibility</p><p className="mt-1 text-sm text-ink-2">{eligibility.message}</p>
      </Card>

      <section aria-labelledby="sc"><div className="mb-3 flex items-center justify-between"><h2 id="sc" className="text-xl font-bold">Your latest scores</h2><LinkButton href="/app/scores" size="sm">Add / manage</LinkButton></div>
        {scores.length === 0 ? <EmptyState title="No scores yet" action={<LinkButton href="/app/scores" size="sm">Add your first score</LinkButton>}>Record a Stableford score from your last round. You need five to enter the draw.</EmptyState> : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">{scores.map((s) => (<li key={s.id}><Card className="p-4 text-center"><p className="text-3xl font-bold tabular-nums">{s.value}</p><p className="mt-1 text-xs text-muted">{formatDate(s.score_date)}</p></Card></li>))}</ul>)}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card><h2 className="text-lg font-bold">Your charity</h2>
          {selection?.charities ? (<><p className="mt-3 text-xl font-semibold"><Link className="hover:underline" href={`/charities/${selection.charities.slug}`}>{selection.charities.name}</Link></p>
            <p className="mt-1 text-sm text-ink-2">{bpsToPercent(selection.contribution_bps)} of each payment{selection.charities.is_demo && <> · <Badge tone="demo">demo charity</Badge></>}</p>
            <Link className="mt-4 inline-block text-sm font-semibold text-forest underline underline-offset-4" href="/app/charity">Change charity or percentage</Link></>)
            : <p className="mt-3 text-sm text-muted">No charity chosen yet. <Link className="underline" href="/app/charity">Pick one</Link>.</p>}
          {events.length > 0 && <div className="mt-5 border-t border-line pt-4"><p className="text-sm font-semibold">Upcoming from your charity</p><ul className="mt-2 space-y-1 text-sm text-ink-2">{events.slice(0, 2).map((e) => <li key={e.id}>{e.title} · {formatDate(e.starts_at)}</li>)}</ul></div>}
        </Card>
        <Card><h2 className="text-lg font-bold">Latest draw</h2>
          {latest ? (<><p className="mt-2 text-sm text-muted">{formatMonth(latest.period_month)}</p>
            <ul className="mt-3 flex gap-2" aria-label="Winning numbers">{latest.winning_numbers.map((n) => <li key={n} className="grid size-10 place-items-center rounded-full bg-forest font-bold text-white tabular-nums">{n}</li>)}</ul>
            <p className="mt-4 text-sm">{myMatch ? <>You matched <strong>{myMatch.match_count}</strong>{myMatch.tier ? <> — a prize!</> : <>. Three or more win a prize.</>}</> : "You weren't in this draw's eligible group."}</p>
            <Link className="mt-3 inline-block text-sm font-semibold text-forest underline underline-offset-4" href={`/app/draws/${latest.id}`}>See details</Link></>)
            : <p className="mt-3 text-sm text-muted">No draw has been published yet. Results appear here as soon as they're out.</p>}
        </Card>
      </div>

      {unpaid.length > 0 && <Card><h2 className="text-lg font-bold">Winnings in progress</h2><ul className="mt-3 divide-y divide-line">{unpaid.map((w) => (<li key={w.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span>{w.draws?.title} · {w.tier} matches · <Money minor={w.amount_minor} /></span><span className="flex items-center gap-3"><StatusBadge status={w.claim_status} /><Link className="font-semibold text-forest underline" href={`/app/winnings/${w.id}`}>Open</Link></span></li>))}</ul></Card>}

      {notes && notes.length > 0 && <Card><div className="flex items-center justify-between"><h2 className="text-lg font-bold">Notifications</h2><Link className="text-sm font-semibold text-forest underline" href="/app/notifications">All</Link></div><ul className="mt-3 space-y-3">{notes.map((n) => <li key={n.id}><p className="font-semibold">{n.title}</p>{n.body && <p className="text-sm text-ink-2">{n.body}</p>}</li>)}</ul></Card>}
    </div>
  );
}
