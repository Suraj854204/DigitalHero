import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { setUserStatus } from "@/app/actions/admin";
import { ConfirmForm } from "@/components/ui/confirm";
import { Card, Money, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { Input } from "@/components/ui/primitives";
import { bpsToPercent, formatDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "User" };

export default async function UserDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireAdminPage();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = createAdminClient();
  const { data: p } = await db.from("profiles").select("id, email, display_name, role, status, created_at, terms_accepted_at").eq("id", id).maybeSingle();
  if (!p) notFound();
  const [sub, sel, contribs, scores, wins, audit] = await Promise.all([
    db.from("subscriptions").select("status, plan_id, current_period_end, cancel_at_period_end, stripe_customer_id").eq("user_id", id).maybeSingle(),
    db.from("charity_selections").select("contribution_bps, effective_from, charities(name)").eq("user_id", id).order("effective_from", { ascending: false }).limit(1).maybeSingle(),
    db.from("contributions").select("id, amount_minor, charity_minor, recognized_at, kind").eq("user_id", id).order("recognized_at", { ascending: false }).limit(10),
    db.from("scores").select("score_date, value").eq("user_id", id).order("score_date", { ascending: false }),
    db.from("winnings").select("id, tier, amount_minor, claim_status").eq("user_id", id),
    db.from("audit_logs").select("id, action, created_at, reason").eq("entity_id", id).order("created_at", { ascending: false }).limit(8),
  ]);
  const s = sel.data as unknown as { contribution_bps: number; effective_from: string; charities: { name: string } | null } | null;
  return (
    <div className="space-y-8">
      <Link href="/admin/users" className="text-sm font-semibold text-forest underline underline-offset-4">← Users</Link>
      <PageHeader eyebrow={p.role} title={p.display_name ?? p.email} accent=""><span className="block">{p.email}</span></PageHeader>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><h2 className="font-bold">Account</h2><dl className="mt-3 space-y-2 text-sm"><div className="flex justify-between"><dt className="text-muted">Status</dt><dd><StatusBadge status={p.status} /></dd></div><div className="flex justify-between"><dt className="text-muted">Joined</dt><dd>{formatDate(p.created_at)}</dd></div><div className="flex justify-between"><dt className="text-muted">Terms accepted</dt><dd>{formatDate(p.terms_accepted_at)}</dd></div></dl>
          {p.id !== actor.id && (<div className="mt-5">{p.status === "active" ?
            <ConfirmForm action={setUserStatus} trigger="Suspend account" triggerVariant="danger" title="Suspend this account?" confirmLabel="Suspend" variant="danger" description="They will be signed out of the member area and excluded from draws. This is recorded in the audit log."><input type="hidden" name="id" value={p.id} /><input type="hidden" name="status" value="suspended" /><label className="block text-sm font-semibold" htmlFor="reason">Reason (kept in the audit log)</label><Input name="reason" required /></ConfirmForm> :
            <ConfirmForm action={setUserStatus} trigger="Reactivate account" title="Reactivate this account?" confirmLabel="Reactivate" description="They will regain access."><input type="hidden" name="id" value={p.id} /><input type="hidden" name="status" value="active" /></ConfirmForm>}</div>)}</Card>
        <Card><h2 className="font-bold">Subscription & charity</h2><dl className="mt-3 space-y-2 text-sm"><div className="flex justify-between"><dt className="text-muted">Subscription</dt><dd>{sub.data ? <><StatusBadge status={sub.data.status} /> {sub.data.plan_id}</> : "none"}</dd></div><div className="flex justify-between"><dt className="text-muted">Period end</dt><dd>{formatDate(sub.data?.current_period_end)}</dd></div><div className="flex justify-between"><dt className="text-muted">Charity</dt><dd>{s?.charities?.name ?? "-"}{s ? ` · ${bpsToPercent(s.contribution_bps)}` : ""}</dd></div></dl></Card>
      </div>
      <Card><h2 className="font-bold">Scores & draw eligibility</h2><p className="mt-1 text-sm text-muted">{(scores.data?.length ?? 0) >= 5 ? "Has five scores." : `Has ${scores.data?.length ?? 0} of 5 scores.`}</p><ul className="mt-3 flex flex-wrap gap-2">{(scores.data ?? []).map((x) => <li key={x.score_date} className="rounded-full bg-paper-2 px-3 py-1 text-sm tabular-nums">{x.value} <span className="text-muted">· {x.score_date}</span></li>)}</ul></Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><h2 className="font-bold">Recent contributions</h2><ul className="mt-3 divide-y divide-line text-sm">{(contribs.data ?? []).map((c) => <li key={c.id} className="flex justify-between py-2"><span>{formatDate(c.recognized_at)}</span><span>Charity <Money minor={c.charity_minor} /> of <Money minor={c.amount_minor} /></span></li>)}{(contribs.data ?? []).length === 0 && <li className="py-2 text-muted">None yet</li>}</ul></Card>
        <Card><h2 className="font-bold">Winnings</h2><ul className="mt-3 divide-y divide-line text-sm">{(wins.data ?? []).map((w) => <li key={w.id} className="flex items-center justify-between py-2"><Link className="underline" href={`/admin/winners/${w.id}`}>{w.tier} matches · <Money minor={w.amount_minor} /></Link><StatusBadge status={w.claim_status} /></li>)}{(wins.data ?? []).length === 0 && <li className="py-2 text-muted">None</li>}</ul></Card>
      </div>
      {(audit.data ?? []).length > 0 && <Card><h2 className="font-bold">Audit trail</h2><ul className="mt-3 space-y-1 text-sm">{audit.data!.map((a) => <li key={a.id}>{formatDate(a.created_at, true)} · {a.action}{a.reason ? ` — ${a.reason}` : ""}</li>)}</ul></Card>}
    </div>
  );
}
