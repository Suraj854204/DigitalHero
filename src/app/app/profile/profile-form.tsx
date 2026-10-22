"use client";
import { useActionState } from "react";
import { updateProfile } from "@/app/actions/member";
import { FormMessage } from "@/components/ui/form-message";
import { Field, Input } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

export function ProfileForm({ displayName }: { displayName: string }) {
  const [state, action] = useActionState(updateProfile, { ok: false });
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage state={state} />
      <Field label="Display name" name="displayName" error={state.errors?.displayName}><Input name="displayName" defaultValue={displayName} required maxLength={80} invalid={!!state.errors?.displayName} /></Field>
      <SubmitButton pendingText="Saving…">Save</SubmitButton>
    </form>
  );
}
