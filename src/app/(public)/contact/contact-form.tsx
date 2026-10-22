"use client";
import { useActionState } from "react";
import { sendContact } from "@/app/actions/contact";
import { FormMessage } from "@/components/ui/form-message";
import { Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";

export function ContactForm() {
  const [state, action] = useActionState(sendContact, { ok: false });
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage state={state} />
      <Field label="Your name" name="name" error={state.errors?.name}><Input name="name" autoComplete="name" required invalid={!!state.errors?.name} /></Field>
      <Field label="Email" name="email" error={state.errors?.email}><Input name="email" type="email" autoComplete="email" required invalid={!!state.errors?.email} /></Field>
      <Field label="Topic" name="topic"><Select name="topic" defaultValue="general"><option value="general">General question</option><option value="support">Account support</option><option value="charity">Charity enquiry</option><option value="press">Press</option></Select></Field>
      <Field label="Message" name="message" error={state.errors?.message}><Textarea name="message" required minLength={10} maxLength={4000} invalid={!!state.errors?.message} /></Field>
      <div className="hidden" aria-hidden><label>Leave this empty<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <SubmitButton pendingText="Sending…">Send message</SubmitButton>
    </form>
  );
}
