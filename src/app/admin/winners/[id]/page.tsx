import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { queuePayoutAction } from "@/app/actions/admin";
import { Alert, Card, Money, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { PayoutForm } from "../../payouts/payout-form";
import { ReviewForm } from "./review-form";

export const metadata: Metadata = { title: "Claim" };

export default async function WinnerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminPage();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = createAdminClient();
  const { data: w } = await db.from("winnings").select("id, tier, amount_minor, claim_status, rejection_reason, user_id, draw_id, profiles(email, display_name), draws(title)").eq("id", id).maybeSingle();
  if (!w) notFound();
  const [{ data: evidence }, { data: payout }, { data: snap }, { data: draw }, { data: audit }] = await Promise.all([
    db.from("winner_evidence").select("id, storage_path, review_status, rejection_reason, submitted_at, reviewed_at, mime_type").eq("winning_id", id).order("submitted_at", { ascending: false }),
    db.from("payouts").select("status, reference, method, notes, paid_at, queued_at").eq("winning_id", id).maybeSingle(),
    db.from("draw_score_snapshots").select("position, score_date, value").eq("draw_id", w.draw_id).eq("user_id", w.user_id).order("position"),
    db.from("draws").select("winning_numbers").eq("id", w.draw_id).maybeSingle(),
    db.from("audit_logs").select("id, action, created_at, reason").eq("entity_type", "winning").eq("entity_id", id).order("created_at", { ascending: false }),
  ]);
  // Short-lived signed URLs, minted server-side only after requireAdminPage() succeeded.
  const files = await Promise.all((evidence ?? []).map(async (e) => ({ ...e, url: (await db.storage.from("winner-evidence").createSignedUrl(e.storage_path, 300)).data?.signedUrl ?? null })));
  const pending = files.find((f) => f.review_status === "pending");
  const profile = w.profiles as unknown as { email: string; display_name: string | null };
  const winning = new Set<number>(draw?.winning_numbers ?? []);

  return (
    <div className="space-y-8">
      <Link href="/admin/winners" className="text-sm font-semibold text-forest underline underline-offset-4">← Winners</Link>
      <PageHeader eyebrow={(w.draws as unknown as { title: string })?.title} title={`${w.tier} matches`} accent=""><span className="block">{profile.display_name ?? profile.email} · {profile.email}</span><span className="mt-1 block"><Money minor={w.amount_minor} className="font-bold" /> · <StatusBadge status={w.claim_status} /></span></PageHeader>

      <Card><h2 className="font-bold">Frozen scores in this draw</h2><p className="mt-1 text-sm text-muted">Compare these with the submitted screenshot.</p><ul className="mt-3 flex flex-wrap gap-2">{(snap ?? []).map((s) => <li key={s.position} className={`rounded-[var(--radius-md)] border px-4 py-2 text-center ${winning.has(s.value) ? "border-forest bg-mint" : "border-line"}`}><p className="text-xl font-bold tabular-nums">{s.value}</p><p className="text-xs text-muted">{formatDate(s.score_date)}</p></li>)}</ul></Card>

      <section><h2 className="mb-3 text-lg font-bold">Submitted evidence</h2>
        {files.length === 0 ? <Alert tone="info">Nothing submitted yet.</Alert> : files.map((f) => (
          <Card key={f.id} className="mb-4"><div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>{formatDate(f.submitted_at, true)} · <StatusBadge status={f.review_status} /></span>{f.url && <a href={f.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-forest underline underline-offset-4">Open full size (expires in 5 min)</a>}</div>
            {f.url && <div className="mt-4 overflow-hidden rounded-[var(--radius-md)] border border-line bg-paper-2">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={f.url} alt="Winner's uploaded score screenshot" className="max-h-[28rem] w-full object-contain" /></div>}
            {f.rejection_reason && <p className="mt-3 text-sm text-danger">Rejected: {f.rejection_reason}</p>}
            {pending?.id === f.id && <div className="mt-5 border-t border-line pt-5"><ReviewForm evidenceId={f.id} /></div>}</Card>))}</section>

      {w.claim_status === "approved" && <Card><h2 className="font-bold">Queue payout</h2><p className="mt-1 text-sm text-ink-2">Moves the claim to “payout pending”. Then make the transfer outside this platform and record its reference.</p><form action={queuePayoutAction} className="mt-4"><input type="hidden" name="winningId" value={w.id} /><SubmitButton pendingText="Queueing…">Queue payout</SubmitButton></form></Card>}
      {w.claim_status === "payout_pending" && <Card><h2 className="font-bold">Record payment</h2><Alert tone="warn" className="mb-4">This platform does not move money. Make the transfer through your bank or payment provider first, then record its reference here. The reference must be unique.</Alert><PayoutForm winningId={w.id} /></Card>}
      {payout?.status === "paid" && <Card><h2 className="font-bold">Paid</h2><p className="mt-2 text-sm">Reference <span className="font-mono font-semibold">{payout.reference}</span> · {payout.method ?? "no method"} · {formatDate(payout.paid_at, true)}</p></Card>}
      {(audit ?? []).length > 0 && <Card><h2 className="font-bold">Audit trail</h2><ul className="mt-3 space-y-1 text-sm">{audit!.map((a) => <li key={a.id}><span className="text-muted">{formatDate(a.created_at, true)}</span> · {a.action}{a.reason ? ` — ${a.reason}` : ""}</li>)}</ul></Card>}
    </div>
  );
}
