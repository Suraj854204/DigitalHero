"use client";
import Link from "next/link";
import { useActionState } from "react";
import { resetPassword } from "@/app/actions/auth";
import { FormMessage } from "@/components/ui/form-message";
import { Field, Input } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

export default function Reset() {
  const [state, action] = useActionState(resetPassword, { ok: false });
  return (
    <>
      <h1 className="text-2xl font-bold">Choose a new <span className="serif-accent">password.</span></h1>
      <form action={action} className="mt-6 space-y-5" noValidate>
        <FormMessage state={state} />
        <Field label="New password" name="password" error={state.errors?.password} hint="At least 10 characters, with a letter and a number."><Input name="password" type="password" autoComplete="new-password" required invalid={!!state.errors?.password} /></Field>
        <SubmitButton className="w-full" pendingText="Saving…">Update password</SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm"><Link className="font-semibold text-forest underline underline-offset-4" href="/forgot-password">Link expired? Request a new one</Link></p>
    </>
  );
}
