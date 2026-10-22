import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Card, Money, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import { requireUserPage } from "@/lib/session";
import { createUserClient } from "@/lib/supabase/server";
import { EvidenceForm } from "./evidence-form";

export const metadata: Metadata = { title: "Prize details" };

const STEPS = [["not_submitted", "Prize won"], ["pending_review", "Proof submitted"], ["approved", "Proof approved"], ["payout_pending", "Payout queued"], ["paid", "Paid"]] as const;

export default async function WinningDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUserPage();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createUserClient();
  const { data: w } = await supabase.from("winnings").select("id, tier, amount_minor, claim_status, rejection_reason, draw_id, draws(title)").eq("id", id).maybeSingle(); // RLS: own only
  if (!w) notFound();
  const [{ data: evidence }, { data: payout }] = await Promise.all([
    supabase.from("winner_evidence").select("id, storage_path, review_status, rejection_reason, submitted_at, reviewed_at").eq("winning_id", id).order("submitted_at", { ascending: false }),
    supabase.from("payouts").select("status, reference, method, paid_at").eq("winning_id", id).maybeSingle(),
  ]);
  const signed = await Promise.all((evidence ?? []).map(async (e) => ({ ...e, url: (await supabase.storage.from("winner-evidence").createSignedUrl(e.storage_path, 300)).data?.signedUrl ?? null })));
  const idx = STEPS.findIndex(([s]) => s === (w.claim_status === "rejected" ? "not_submitted" : w.claim_status));
  const canSubmit = w.claim_status === "not_submitted" || w.claim_status === "rejected";
  const draw = w.draws as unknown as { title: string } | null;

  return (
    <div className="space-y-8">
      <Link href="/app/winnings" className="text-sm font-semibold text-forest underline underline-offset-4">← All winnings</Link>
      <PageHeader eyebrow={draw?.title} title={`${w.tier} matches:`} accent="your prize."><Money minor={w.amount_minor} className="text-2xl font-bold text-ink" /> · <StatusBadge status={w.claim_status} /></PageHeader>

      <Card><h2 className="text-lg font-bold">Progress</h2>
        <ol className="mt-5 grid gap-4 sm:grid-cols-5">{STEPS.map(([s, label], i) => (<li key={s} className="flex items-center gap-3 sm:block"><span aria-hidden className={`grid size-9 place-items-center rounded-full text-sm font-bold ${i <= idx ? "bg-forest text-white" : "bg-paper-2 text-muted"}`}>{i < idx ? "✓" : i + 1}</span><span className={`text-sm sm:mt-2 sm:block ${i <= idx ? "font-semibold" : "text-muted"}`}>{label}</span></li>))}</ol></Card>

      {w.claim_status === "rejected" && <Alert tone="error"><strong>Your proof wasn't accepted.</strong> {w.rejection_reason} You can upload a new screenshot below.</Alert>}
      {canSubmit && <Card><h2 className="text-lg font-bold">{w.claim_status === "rejected" ? "Upload new proof" : "Submit your proof"}</h2><p className="mb-5 mt-1 text-sm text-muted">Upload a screenshot from your golf app or scorecard that shows the five scores used in this draw.</p><EvidenceForm winningId={w.id} /></Card>}
      {w.claim_status === "pending_review" && <Alert tone="info">Your proof is waiting for review. We'll notify you as soon as it's been looked at.</Alert>}
      {w.claim_status === "approved" && <Alert tone="success">Proof approved. Your payout will be queued next.</Alert>}
      {w.claim_status === "payout_pending" && <Alert tone="info">Your payout is queued. It will be marked paid, with a transfer reference, once the transfer has been made.</Alert>}
      {payout?.status === "paid" && <Card><h2 className="text-lg font-bold">Payout</h2><dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><div><dt className="text-muted">Paid on</dt><dd className="font-semibold">{formatDate(payout.paid_at, true)}</dd></div><div><dt className="text-muted">Reference</dt><dd className="font-mono font-semibold">{payout.reference}</dd></div><div><dt className="text-muted">Method</dt><dd className="font-semibold">{payout.method ?? "-"}</dd></div></dl></Card>}

      {signed.length > 0 && <section><h2 className="mb-3 text-lg font-bold">Your submissions</h2><ul className="space-y-3">{signed.map((e) => (<li key={e.id}><Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"><span>{formatDate(e.submitted_at, true)} · <StatusBadge status={e.review_status} />{e.rejection_reason && <span className="ml-2 text-danger">{e.rejection_reason}</span>}</span>{e.url && <a className="font-semibold text-forest underline underline-offset-4" href={e.url} target="_blank" rel="noopener noreferrer">View file (link expires in 5 min)</a>}</Card></li>))}</ul></section>}
    </div>
  );
}
