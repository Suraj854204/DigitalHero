"use client";
import { useActionState, useState } from "react";
import { addScore, deleteScore, updateScore } from "@/app/actions/scores";
import { buttonClass } from "@/components/ui/button-styles";
import { ConfirmForm } from "@/components/ui/confirm";
import { FormMessage } from "@/components/ui/form-message";
import { Card, EmptyState, Field, Input } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDate } from "@/lib/format";

type Score = { id: string; score_date: string; value: number };

export function AddScoreForm({ today }: { today: string }) {
  const [state, action] = useActionState(addScore, { ok: false });
  return (
    <Card>
      <h2 className="text-lg font-bold">Add a score</h2>
      <p className="mt-1 text-sm text-muted">Stableford points from a round you played. One score per date; your five most recent are kept.</p>
      <form action={action} className="mt-5 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" noValidate key={state.ok ? "reset" : "form"}>
        <Field label="Date played" name="scoreDate" error={state.errors?.scoreDate}><Input name="scoreDate" type="date" max={today} defaultValue={today} required invalid={!!state.errors?.scoreDate} /></Field>
        <Field label="Stableford points (1–45)" name="value" error={state.errors?.value}><Input name="value" type="number" inputMode="numeric" min={1} max={45} step={1} required invalid={!!state.errors?.value} /></Field>
        <SubmitButton pendingText="Adding…">Add score</SubmitButton>
      </form>
      <div className="mt-4" aria-live="polite"><FormMessage state={state} /></div>
    </Card>
  );
}

function ScoreItem({ s, today }: { s: Score; today: string }) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState(async (p: Parameters<typeof updateScore>[0], fd: FormData) => {
    const r = await updateScore(p, fd);
    if (r.ok) setEditing(false);
    return r;
  }, { ok: false });

  if (editing) {
    return (
      <li className="rounded-[var(--radius-md)] border border-forest/40 bg-card p-4">
        <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end" noValidate>
          <input type="hidden" name="id" value={s.id} />
          <Field label="Date" name={`d-${s.id}`} error={state.errors?.scoreDate}><Input name="scoreDate" id={`d-${s.id}`} type="date" max={today} defaultValue={s.score_date} required /></Field>
          <Field label="Points" name={`v-${s.id}`} error={state.errors?.value}><Input name="value" id={`v-${s.id}`} type="number" min={1} max={45} step={1} defaultValue={s.value} required /></Field>
          <SubmitButton size="sm" pendingText="Saving…">Save</SubmitButton>
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setEditing(false)}>Cancel</button>
        </form>
        <div className="mt-3"><FormMessage state={state} /></div>
      </li>
    );
  }
  return (
    <li className="flex items-center justify-between gap-4 rounded-[var(--radius-md)] border border-line bg-card px-5 py-4">
      <div className="flex items-center gap-4"><span className="grid size-12 place-items-center rounded-full bg-mint text-xl font-bold tabular-nums text-forest-2">{s.value}</span><div><p className="font-semibold">{formatDate(s.score_date)}</p><p className="text-xs text-muted">Stableford points</p></div></div>
      <div className="flex items-center gap-2">
        <button className={buttonClass("secondary", "sm")} onClick={() => setEditing(true)}>Edit</button>
        <ConfirmForm action={deleteScore} trigger="Delete" triggerVariant="ghost" title="Delete this score?" confirmLabel="Delete score" variant="danger"
          description={<>Remove the {s.value} from {formatDate(s.score_date)}. If you drop below five scores you won't be eligible for the next draw until you add another.</>}>
          <input type="hidden" name="id" value={s.id} />
        </ConfirmForm>
      </div>
    </li>
  );
}

export function ScoreList({ scores, today }: { scores: Score[]; today: string }) {
  if (scores.length === 0) return <EmptyState title="No scores yet">Add your first score above. Once you have five, you're eligible for the monthly draw.</EmptyState>;
  return <ul className="space-y-3">{scores.map((s) => <ScoreItem key={s.id} s={s} today={today} />)}</ul>;
}
