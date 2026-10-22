"use client";
import { useActionState } from "react";
import { saveSettings } from "@/app/actions/admin";
import { FormMessage } from "@/components/ui/form-message";
import { Field, Input, Select } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

export interface SettingsValues { prizePoolBps: number; confirmed: boolean; s5: number; s4: number; s3: number; unclaimedPolicy: "reserve" | "jackpot"; monthlyPrice: number; yearlyPrice: number }

export function SettingsForm({ v }: { v: SettingsValues }) {
  const [state, action] = useActionState(saveSettings, { ok: false });
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-8" noValidate>
      <FormMessage state={state} />
      <fieldset className="grid gap-4 sm:grid-cols-2"><legend className="mb-2 text-lg font-bold">Prize pool</legend>
        <Field label="Prize pool share (basis points)" name="prizePoolBps" hint="5000 = 50% of each recognised payment. ASSUMPTION until you confirm." error={e.prizePoolBps}><Input name="prizePoolBps" id="prizePoolBps" type="number" min={0} max={9000} defaultValue={v.prizePoolBps} /></Field>
        <label className="flex items-start gap-3 self-center text-sm"><input type="checkbox" name="confirmed" defaultChecked={v.confirmed} className="mt-1 size-4" />I have confirmed this percentage with the client.</label></fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-4"><legend className="mb-2 text-lg font-bold">Tier shares (basis points, total 10000)</legend>
        <Field label="5 matches" name="s5"><Input name="s5" id="s5" type="number" defaultValue={v.s5} /></Field>
        <Field label="4 matches" name="s4"><Input name="s4" id="s4" type="number" defaultValue={v.s4} /></Field>
        <Field label="3 matches" name="s3"><Input name="s3" id="s3" type="number" defaultValue={v.s3} /></Field>
        <Field label="Unclaimed 4/3 tiers" name="unclaimedPolicy"><Select name="unclaimedPolicy" id="unclaimedPolicy" defaultValue={v.unclaimedPolicy}><option value="reserve">Hold in reserve</option><option value="jackpot">Add to jackpot</option></Select></Field></fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2"><legend className="mb-2 text-lg font-bold">Prices (₹, whole rupees)</legend>
        <Field label="Monthly" name="monthlyPrice" error={e.monthlyPrice}><Input name="monthlyPrice" id="monthlyPrice" type="number" min={1} defaultValue={v.monthlyPrice} /></Field>
        <Field label="Yearly" name="yearlyPrice" error={e.yearlyPrice}><Input name="yearlyPrice" id="yearlyPrice" type="number" min={1} defaultValue={v.yearlyPrice} /></Field></fieldset>
      <SubmitButton pendingText="Saving…">Save settings</SubmitButton>
    </form>
  );
}
