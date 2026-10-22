"use client";
import { useActionState, useState } from "react";
import { reviewEvidenceAction } from "@/app/actions/admin";
import { buttonClass } from "@/components/ui/button-styles";
import { FormMessage } from "@/components/ui/form-message";
import { Field, Textarea } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

export function ReviewForm({ evidenceId }: { evidenceId: string }) {
  const [state, action] = useActionState(reviewEvidenceAction, { ok: false });
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="evidenceId" value={evidenceId} />
      <FormMessage state={state} />
      <fieldset className="flex gap-3"><legend className="sr-only">Decision</legend>
        {(["approve", "reject"] as const).map((d) => (<label key={d} className={`cursor-pointer rounded-full border px-5 py-2 text-sm font-semibold has-[:checked]:text-white ${d === "approve" ? "has-[:checked]:bg-forest has-[:checked]:border-forest" : "has-[:checked]:bg-danger has-[:checked]:border-danger"} border-line`}><input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} className="sr-only" />{d === "approve" ? "Approve" : "Reject"}</label>))}</fieldset>
      {decision === "reject" && <Field label="Reason shown to the winner" name="reason" error={state.errors?.reason}><Textarea name="reason" required minLength={5} maxLength={500} className="min-h-24" /></Field>}
      <SubmitButton variant={decision === "approve" ? "primary" : "danger"} pendingText="Saving…">{decision === "approve" ? "Approve evidence" : "Reject evidence"}</SubmitButton>
      <button type="button" className={buttonClass("ghost", "sm")} hidden />
    </form>
  );
}
