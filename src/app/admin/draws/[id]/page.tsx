import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { approveDrawAction, cancelDrawAction, publishDrawAction, simulateDrawAction, unapproveDrawAction } from "@/app/actions/admin";
import { ConfirmForm } from "@/components/ui/confirm";
import { Alert, Card, Input, Money, PageHeader, StatusBadge, Table } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { loadDraw } from "@/lib/admin/draws";
import { bpsToPercent, formatDate, formatMonth } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Draw" };
const STEPS = ["draft", "simulated", "approved", "published"] as const;

export default async function DrawAdmin({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminPage();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = createAdminClient();
  const d = await loadDraw(db, id).catch(() => null);
  if (!d) notFound();
  const open = d.status === "draft" || d.status === "simulated";
  const cutoffPassed = new Date(d.eligibility_cutoff) <= new Date();

  const [preview, poolRes, jackpotRes, sims, audits, allocs, winners] = await Promise.all([
    open ? db.rpc("compute_eligible_snapshot", { p_cutoff: d.eligibility_cutoff }) : Promise.resolve({ data: null }),
    open ? db.rpc("unallocated_pool_minor", { p_cutoff: d.eligibility_cutoff }) : Promise.resolve({ data: null }),
    db.rpc("public_jackpot_balance"),
    db.from("draw_simulations").select("id, created_at, winning_numbers, summary, random_source").eq("draw_id", id).order("created_at", { ascending: false }).limit(3),
    db.from("audit_logs").select("id, action, created_at, reason, actor_id").eq("entity_type", "draw").eq("entity_id", id).order("created_at", { ascending: false }).limit(20),
    db.from("prize_allocations").select("*").eq("draw_id", id).order("tier", { ascending: false }),
    db.from("winnings").select("id, tier, amount_minor, claim_status, profiles(email)").eq("draw_id", id).order("tier", { ascending: false }),
  ]);
  const eligibleCount = new Set((preview.data as { user_id: string }[] | null)?.map((r) => r.user_id)).size;
  const cfg = d.tier_config;
  const stepIdx = STEPS.indexOf(d.status as (typeof STEPS)[number]);

  return (
    <div className="space-y-8">
      <Link href="/admin/draws" className="text-sm font-semibold text-forest underline underline-offset-4">← Draws</Link>
      <PageHeader eyebrow={formatMonth(d.period_month)} title={d.title} accent=""><StatusBadge status={d.status} /> · {d.mode} mode · cutoff {formatDate(d.eligibility_cutoff, true)}</PageHeader>

      <Card><ol className="grid gap-3 sm:grid-cols-4">{STEPS.map((s, i) => (<li key={s} className="flex items-center gap-3"><span aria-hidden className={`grid size-8 place-items-center rounded-full text-sm font-bold ${d.status === "cancelled" ? "bg-paper-2 text-muted" : i <= stepIdx ? "bg-forest text-white" : "bg-paper-2 text-muted"}`}>{i + 1}</span><span className={`text-sm capitalize ${i === stepIdx ? "font-bold" : "text-muted"}`}>{s === "approved" ? "Approved (frozen)" : s}</span></li>))}</ol></Card>

      {open && (<>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="p-5"><p className="font-mono text-xs uppercase tracking-widest text-muted">Eligible right now</p><p className="mt-2 text-3xl font-bold tabular-nums">{eligibleCount}</p><p className="mt-1 text-xs text-muted">Live preview. The snapshot is frozen only when you approve.</p></Card>
          <Card className="p-5"><p className="font-mono text-xs uppercase tracking-widest text-muted">Prize pool preview</p><p className="mt-2 text-3xl font-bold"><Money minor={poolRes.data as number} /></p><p className="mt-1 text-xs text-muted">Unallocated pool contributions up to the cutoff.</p></Card>
          <Card className="p-5"><p className="font-mono text-xs uppercase tracking-widest text-muted">Jackpot carried in</p><p className="mt-2 text-3xl font-bold"><Money minor={jackpotRes.data as number} /></p></Card>
        </div>
        <Card><h2 className="font-bold">Prize tiers (frozen at approval)</h2><p className="mt-2 text-sm text-ink-2">5 matches {bpsToPercent(cfg.shareBps[5])} · 4 matches {bpsToPercent(cfg.shareBps[4])} · 3 matches {bpsToPercent(cfg.shareBps[3])} · five-match rolls over · unclaimed 4/3 tiers: {cfg.unclaimedPolicy === "jackpot" ? "added to jackpot" : "held in reserve"}</p></Card>

        <Alert tone="warn"><strong>Simulation is not publication.</strong> A simulation draws a trial set of numbers so you can preview winners and prizes. It writes no winnings, payouts or ledger entries, and its numbers are <em>not</em> reused: publishing draws fresh numbers over the frozen snapshot.</Alert>
        {(sims.data ?? []).map((s, i) => { const sum = s.summary as { participants: number; poolMinor: number; winnersByTier: Record<string, number>; paidMinor: number; carryOutMinor: number; reserveMinor: number }; return (
          <Card key={s.id} className="border-dashed border-gold bg-[#fbf3dc]/60"><p className="font-mono text-xs uppercase tracking-widest text-[#6d4e0c]">Simulation {i === 0 ? "(latest)" : ""} · {formatDate(s.created_at, true)} · NOT PUBLISHED</p>
            <ul className="mt-3 flex gap-2" aria-label="Simulated numbers">{(s.winning_numbers as number[]).map((n) => <li key={n} className="grid size-10 place-items-center rounded-full border border-dashed border-gold bg-white font-bold tabular-nums">{n}</li>)}</ul>
            <p className="mt-3 text-sm">{sum.participants} participants · winners 5/4/3: {sum.winnersByTier[5]}/{sum.winnersByTier[4]}/{sum.winnersByTier[3]} · prizes paid <Money minor={sum.paidMinor} /> · rolls over <Money minor={sum.carryOutMinor} /> · reserve <Money minor={sum.reserveMinor} /></p></Card>); })}
        <div className="flex flex-wrap items-center gap-3">
          <form action={simulateDrawAction}><input type="hidden" name="id" value={d.id} /><SubmitButton variant="secondary" pendingText="Simulating…">{d.status === "draft" ? "Run simulation" : "Run another simulation"}</SubmitButton></form>
          {d.status === "simulated" && (cutoffPassed ?
            <ConfirmForm action={approveDrawAction} trigger="Approve and freeze snapshot" triggerVariant="primary" title="Approve and freeze this draw?" confirmLabel="Approve and freeze" description={<>This locks the eligible participants, their five scores, the prize pool and the jackpot. Nothing is paid yet. You can still withdraw approval before publishing. Eligible now: <strong>{eligibleCount}</strong>.</>}><input type="hidden" name="id" value={d.id} /></ConfirmForm> :
            <p className="text-sm text-muted">Approval unlocks after the cutoff ({formatDate(d.eligibility_cutoff, true)}).</p>)}
          <ConfirmForm action={cancelDrawAction} trigger="Cancel draw" triggerVariant="ghost" title="Cancel this draw?" confirmLabel="Cancel draw" variant="danger" description="A cancelled draw can't be reopened. You can create a new draw for the same month."><input type="hidden" name="id" value={d.id} /><label htmlFor="creason" className="block text-sm font-semibold">Reason</label><Input name="reason" id="creason" /></ConfirmForm>
        </div>
      </>)}

      {d.status === "approved" && (<>
        <Alert tone="info"><strong>Frozen.</strong> {d.participant_count} participants · pool <Money minor={d.pool_minor} /> · jackpot carried in <Money minor={d.jackpot_carry_in_minor} /> · snapshot <span className="font-mono">{d.snapshot_hash?.slice(0, 16)}…</span></Alert>
        <Card className="border-coral/50"><h2 className="text-lg font-bold">Publish this draw</h2><p className="mt-2 text-sm leading-relaxed text-ink-2">Publishing draws the real winning numbers with a cryptographically secure generator, creates winnings, notifies winners and posts the prize allocation to the ledger. <strong>It cannot be undone or repeated.</strong></p>
          <div className="mt-5 flex flex-wrap gap-3">
            <ConfirmForm action={publishDrawAction} trigger="Publish draw" triggerVariant="coral" title="Publish this draw for real?" confirmLabel="Publish now" variant="coral" description="This is final. Winning numbers will be drawn now, prizes allocated and winners notified. A published draw is immutable."><input type="hidden" name="id" value={d.id} /><label htmlFor="pc" className="block text-sm font-semibold">Type PUBLISH to confirm</label><Input name="confirm" id="pc" autoComplete="off" required /></ConfirmForm>
            <ConfirmForm action={unapproveDrawAction} trigger="Withdraw approval" triggerVariant="ghost" title="Withdraw approval?" confirmLabel="Withdraw" variant="danger" description="The frozen snapshot is discarded and the draw returns to 'simulated'. A reason is recorded in the audit log."><input type="hidden" name="id" value={d.id} /><label htmlFor="ur" className="block text-sm font-semibold">Reason</label><Input name="reason" id="ur" required minLength={5} /></ConfirmForm>
          </div></Card>
      </>)}

      {d.status === "published" && (<>
        <Card><h2 className="text-lg font-bold">Published result</h2><ul className="mt-4 flex gap-3" aria-label="Winning numbers">{d.winning_numbers!.map((n) => <li key={n} className="grid size-12 place-items-center rounded-full bg-forest text-lg font-bold text-white tabular-nums">{n}</li>)}</ul>
          <p className="mt-4 text-xs text-muted">Published {formatDate(d.published_at, true)} · {d.random_source} source · result hash <span className="font-mono">{d.result_hash?.slice(0, 24)}…</span>. This draw is immutable; any correction needs a documented, audited procedure (docs/DECISIONS.md).</p></Card>
        <Table caption="Tier allocations" head={["Tier", "Allocation", "Carried in", "Fund", "Winners", "Paid", "Unclaimed"]}>{(allocs.data ?? []).map((a) => <tr key={a.tier}><td className="font-semibold">{a.tier} matches</td><td><Money minor={a.allocation_minor} /></td><td><Money minor={a.carry_in_minor} /></td><td><Money minor={a.fund_minor} /></td><td>{a.winner_count}</td><td><Money minor={a.paid_minor} /></td><td><Money minor={a.unclaimed_minor} /></td></tr>)}</Table>
        <Table caption="Winners" head={["Winner", "Tier", "Prize", "Claim", ""]}>{((winners.data ?? []) as unknown as { id: string; tier: number; amount_minor: number; claim_status: string; profiles: { email: string } | null }[]).map((w) => <tr key={w.id}><td>{w.profiles?.email}</td><td>{w.tier}</td><td><Money minor={w.amount_minor} /></td><td><StatusBadge status={w.claim_status} /></td><td className="text-right"><Link className="font-semibold text-forest underline" href={`/admin/winners/${w.id}`}>Open</Link></td></tr>)}</Table>
      </>)}

      {(audits.data ?? []).length > 0 && <Card><h2 className="font-bold">Audit trail</h2><ul className="mt-3 space-y-1 text-sm">{audits.data!.map((a) => <li key={a.id}><span className="text-muted">{formatDate(a.created_at, true)}</span> · {a.action}{a.reason ? ` — ${a.reason}` : ""}</li>)}</ul></Card>}
    </div>
  );
}
