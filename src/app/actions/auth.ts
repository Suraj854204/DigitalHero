"use server";
import { redirect } from "next/navigation";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";
import { safeNext } from "@/lib/redirect";
import { createUserClient } from "@/lib/supabase/server";
import { forgotSchema, formObject, loginSchema, resetSchema, signupSchema, zodErrors, type ActionState } from "@/lib/validation";

const NOT_CONFIGURED: ActionState = { ok: false, message: "This environment isn't connected to Supabase yet, so accounts are unavailable. See docs/SETUP.md." };

export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signupSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;

  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${publicEnv.siteUrl}/auth/callback?next=/onboarding`,
    },
  });
  if (error) {
    // Do not reveal whether an address is already registered.
    if (/password/i.test(error.message)) return { ok: false, errors: { password: "Choose a stronger password." } };
    return { ok: false, message: "We couldn't create your account. Please check your details and try again." };
  }
  if (data.session) redirect("/onboarding");
  return { ok: true, message: "Check your inbox. We've sent a link to confirm your email, then you can finish setting up." };
}

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;

  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) return { ok: false, message: /confirm/i.test(error?.message ?? "") ? "Please confirm your email first. Check your inbox for the link." : "Incorrect email or password." };

  const { data: profile } = await supabase.from("profiles").select("role, status, onboarding_completed_at").eq("id", data.user.id).maybeSingle();
  if (profile?.status === "suspended") {
    await supabase.auth.signOut();
    return { ok: false, message: "This account has been suspended. Please contact support." };
  }
  const next = safeNext(String(formData.get("next") ?? ""), "");
  if (next) redirect(next);
  if (profile?.role === "admin") redirect("/admin");
  redirect(profile?.onboarding_completed_at ? "/app" : "/onboarding");
}

export async function signOut() {
  if (isSupabaseConfigured()) await (await createUserClient()).auth.signOut();
  redirect("/");
}

export async function requestPasswordReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = forgotSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  await (await createUserClient()).auth.resetPasswordForEmail(parsed.data.email, { redirectTo: `${publicEnv.siteUrl}/auth/callback?next=/reset-password` });
  // Same answer whether or not the account exists.
  return { ok: true, message: "If an account exists for that email, a reset link is on its way." };
}

export async function resetPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = resetSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const supabase = await createUserClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, message: "Your reset link has expired. Please request a new one." };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, message: "We couldn't update your password. Try a different one." };
  redirect("/app");
}
