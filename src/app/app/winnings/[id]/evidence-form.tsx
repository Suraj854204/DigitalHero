"use client";
import { useActionState } from "react";
import { submitEvidence } from "@/app/actions/evidence";
import { FormMessage } from "@/components/ui/form-message";
import { Field, inputClass } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

export function EvidenceForm({ winningId }: { winningId: string }) {
  const [state, action] = useActionState(submitEvidence, { ok: false });
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="winningId" value={winningId} />
      <FormMessage state={state} />
      <Field label="Screenshot of your scores" name="file" error={state.errors?.file} hint="PNG, JPEG or WebP, up to 5 MB. It must clearly show your scores and dates.">
        <input id="file" name="file" type="file" accept="image/png,image/jpeg,image/webp" required className={`${inputClass} file:mr-4 file:rounded-full file:border-0 file:bg-mint file:px-4 file:py-2 file:font-semibold file:text-forest-2`} />
      </Field>
      <SubmitButton pendingText="Uploading…">Submit for review</SubmitButton>
    </form>
  );
}
