"use client";
import { useActionState, useState } from "react";
import { changeCharity } from "@/app/actions/member";
import { FormMessage } from "@/components/ui/form-message";
import { Field, Input, Select } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

export function CharityForm({ charities, currentId, currentPercent }: { charities: { id: string; name: string; category: string | null }[]; currentId?: string; currentPercent: number }) {
  const [state, action] = useActionState(changeCharity, { ok: false });
  const [pct, setPct] = useState(currentPercent);
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage state={state} />
      <Field label="Charity" name="charityId" error={state.errors?.charityId}>
        <Select name="charityId" defaultValue={currentId ?? ""} required><option value="" disabled>Choose a charity…</option>{charities.map((c) => <option key={c.id} value={c.id}>{c.name}{c.category ? ` (${c.category})` : ""}</option>)}</Select></Field>
      <Field label="Share of each payment (min 10%)" name="percent" error={state.errors?.percent} hint="Applies to payments recorded from now on.">
        <div className="flex items-center gap-4"><input type="range" min={10} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} aria-label="Charity percentage" className="h-2 flex-1 accent-[var(--color-coral)]" />
          <div className="w-28"><Input name="percent" type="number" min={10} max={100} step="0.01" value={pct} onChange={(e) => setPct(Number(e.target.value))} /></div></div></Field>
      <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
    </form>
  );
}
