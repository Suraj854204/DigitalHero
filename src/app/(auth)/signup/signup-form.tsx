"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { signUp } from "@/app/actions/auth";
import { FormMessage } from "@/components/ui/form-message";
import { Field, Input } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/button-styles";
import { signupSchema, type ActionState } from "@/lib/validation";
import { zodResolver } from "@/lib/zod-resolver";

type Values = { displayName: string; email: string; password: string; acceptTerms: boolean };

export function SignupForm() {
  const [pending, start] = useTransition();
  const [server, setServer] = useState<ActionState>({ ok: false });
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({ resolver: zodResolver<Values>(signupSchema), defaultValues: { acceptTerms: false } });

  const onSubmit = handleSubmit((v) =>
    start(async () => {
      const fd = new FormData();
      fd.set("displayName", v.displayName); fd.set("email", v.email); fd.set("password", v.password);
      if (v.acceptTerms) fd.set("acceptTerms", "on");
      setServer(await signUp({ ok: false }, fd)); // redirects on success when email confirmation is off
    }),
  );

  if (server.ok) return <FormMessage state={server} />;
  const e = (k: keyof Values) => errors[k]?.message ?? server.errors?.[k];
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <FormMessage state={server} />
      <Field label="What should we call you?" name="displayName" error={e("displayName")}><Input autoComplete="name" invalid={!!e("displayName")} {...register("displayName")} /></Field>
      <Field label="Email" name="email" error={e("email")}><Input type="email" autoComplete="email" invalid={!!e("email")} {...register("email")} /></Field>
      <Field label="Password" name="password" error={e("password")} hint="At least 10 characters, with a letter and a number."><Input type="password" autoComplete="new-password" invalid={!!e("password")} {...register("password")} /></Field>
      <div>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4 accent-[var(--color-forest)]" {...register("acceptTerms")} />
          <span>I agree to the <Link className="underline" href="/terms" target="_blank">terms</Link> and <Link className="underline" href="/privacy" target="_blank">privacy policy</Link>.</span></label>
        {e("acceptTerms") && <p role="alert" className="mt-1 text-sm font-medium text-danger">{e("acceptTerms")}</p>}
      </div>
      <button className={`${buttonClass("coral")} w-full`} disabled={pending}>{pending ? "Creating account…" : "Create account"}</button>
    </form>
  );
}
