"use client";
import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset } from "@/app/actions/auth";
import { FormMessage } from "@/components/ui/form-message";
import { Field, Input } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

export default function Forgot() {
  const [state, action] = useActionState(requestPasswordReset, { ok: false });
  return (
    <>
      <h1 className="text-2xl font-bold">Reset your <span className="serif-accent">password.</span></h1>
      <p className="mt-1 text-sm text-muted">Enter your email and we'll send a reset link.</p>
      <form action={action} className="mt-6 space-y-5" noValidate>
        <FormMessage state={state} />
        <Field label="Email" name="email" error={state.errors?.email}><Input name="email" type="email" autoComplete="email" required invalid={!!state.errors?.email} /></Field>
        <SubmitButton className="w-full" pendingText="Sending…">Send reset link</SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm"><Link className="font-semibold text-forest underline underline-offset-4" href="/login">Back to log in</Link></p>
    </>
  );
}
