"use client";
import { useActionState } from "react";
import { markPaidAction } from "@/app/actions/admin";
import { FormMessage } from "@/components/ui/form-message";
import { Field, Input } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

export function PayoutForm({ winningId }: { winningId: string }) {
  const [state, action] = useActionState(markPaidAction, { ok: false });
  const e = state.errors ?? {};
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-[1.4fr_1fr_1.4fr_auto] sm:items-end" noValidate>
      <input type="hidden" name="winningId" value={winningId} />
      <Field label="Transfer reference" name={`ref-${winningId}`} error={e.reference}><Input name="reference" id={`ref-${winningId}`} placeholder="e.g. UTR / UPI txn id" required minLength={4} invalid={!!e.reference} /></Field>
      <Field label="Method" name={`m-${winningId}`}><Input name="method" id={`m-${winningId}`} placeholder="UPI, bank…" /></Field>
      <Field label="Notes" name={`n-${winningId}`}><Input name="notes" id={`n-${winningId}`} /></Field>
      <SubmitButton size="sm" pendingText="Saving…">Mark paid</SubmitButton>
      <div className="sm:col-span-4"><FormMessage state={state} /></div>
    </form>
  );
}
