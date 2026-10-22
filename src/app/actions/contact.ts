"use server";
import { headers } from "next/headers";
import { isServiceRoleConfigured, isSupabaseConfigured } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { contactSchema, formObject, zodErrors, type ActionState } from "@/lib/validation";

export async function sendContact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = contactSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
  // Honeypot: bots fill the hidden "website" field. Pretend success, store nothing.
  if (parsed.data.website) return { ok: true, message: "Thanks, your message is on its way." };

  const ip = ((await headers()).get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const rl = rateLimit(`contact:${ip}`, 3, 10 * 60_000);
  if (!rl.ok) return { ok: false, message: "You've sent a few messages already. Please try again in a few minutes." };

  if (!isSupabaseConfigured() || !isServiceRoleConfigured()) {
    return { ok: false, message: "Our message inbox isn't connected in this environment, so nothing was sent. Please try again later." };
  }
  const { error } = await createAdminClient().from("contact_messages").insert({
    name: parsed.data.name, email: parsed.data.email, topic: parsed.data.topic, message: parsed.data.message,
  });
  if (error) return { ok: false, message: "We couldn't save your message. Please try again." };
  return { ok: true, message: "Thanks, we've received your message and will reply by email." };
}
