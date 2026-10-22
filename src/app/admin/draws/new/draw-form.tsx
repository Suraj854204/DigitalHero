"use client";
import { useActionState, useState } from "react";
import { createDraw } from "@/app/actions/admin";
import { FormMessage } from "@/components/ui/form-message";
import { Field, Input, Select } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

export function DrawForm({ defaultMonth, defaultCutoff }: { defaultMonth: string; defaultCutoff: string }) {
  const [state, action] = useActionState(createDraw, { ok: false });
  const [mode, setMode] = useState("random");
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage state={state} />
      <Field label="Draw month" name="periodMonth" error={e.periodMonth}><Input name="periodMonth" type="month" defaultValue={defaultMonth} required /></Field>
      <Field label="Title" name="title" error={e.title}><Input name="title" defaultValue={`Monthly draw ${defaultMonth}`} required /></Field>
      <Field label="Eligibility cutoff (end of day, UTC)" name="cutoffDate" error={e.cutoffDate} hint="Scores and subscription status are evaluated at this moment. It must have passed before you can approve."><Input name="cutoffDate" type="date" defaultValue={defaultCutoff} required /></Field>
      <Field label="Number selection" name="mode"><Select name="mode" value={mode} onChange={(ev) => setMode(ev.target.value)}><option value="random">Random: uniform over 1–45</option><option value="weighted">Weighted by score frequency</option></Select></Field>
      {mode === "weighted" && (<div className="grid gap-5 rounded-[var(--radius-md)] bg-paper-2 p-4 sm:grid-cols-2">
        <Field label="Bias" name="weightBias" hint="Favour frequently or rarely scored numbers."><Select name="weightBias"><option value="frequent">Frequent numbers</option><option value="rare">Rare numbers</option></Select></Field>
        <Field label="Smoothing" name="weightSmoothing" hint="Added to every weight so unscored numbers can still be drawn."><Input name="weightSmoothing" type="number" min={0} max={100} defaultValue={1} /></Field>
        <p className="text-xs text-muted sm:col-span-2">Weighted mode favours numbers by how often members scored them. We make no claim that it is statistically fairer than uniform random.</p></div>)}
      <SubmitButton pendingText="Creating…">Create draft draw</SubmitButton>
    </form>
  );
}
