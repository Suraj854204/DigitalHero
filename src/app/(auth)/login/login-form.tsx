"use client";
import Link from "next/link";
import { useActionState } from "react";
import { signIn } from "@/app/actions/auth";
import { FormMessage } from "@/components/ui/form-message";
import { Field, Input } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signIn, { ok: false });
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage state={state} />
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="Email" name="email" error={state.errors?.email}><Input name="email" type="email" autoComplete="email" required invalid={!!state.errors?.email} /></Field>
      <Field label="Password" name="password" error={state.errors?.password}><Input name="password" type="password" autoComplete="current-password" required invalid={!!state.errors?.password} /></Field>
      <div className="text-right text-sm"><Link className="font-semibold text-forest underline underline-offset-4" href="/forgot-password">Forgot password?</Link></div>
      <SubmitButton className="w-full" pendingText="Logging in…">Log in</SubmitButton>
    </form>
  );
}
