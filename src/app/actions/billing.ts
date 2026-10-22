"use server";
import { redirect } from "next/navigation";
import { isServiceRoleConfigured, isStripeConfigured, isSupabaseConfigured, publicEnv, serverEnv } from "@/lib/env";
import { requireActor } from "@/lib/authz";
import { getSession } from "@/lib/session";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUserClient } from "@/lib/supabase/server";
import { formObject, onboardingSchema, zodErrors, type ActionState } from "@/lib/validation";

const TERMS_VERSION = "2026-01";

export async function startCheckout(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  const actor = requireActor(session?.actor);
  const parsed = onboardingSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
  if (!isSupabaseConfigured() || !isServiceRoleConfigured()) return { ok: false, message: "Accounts aren't connected in this environment. See docs/SETUP.md." };
  if (!isStripeConfigured()) return { ok: false, message: "Payments aren't connected in this environment (Stripe test keys missing), so checkout can't start. Your choices have been saved." };

  const supabase = await createUserClient();
  const admin = createAdminClient();
  const bps = Math.round(parsed.data.charityPercent * 100);

  // Validate the charity and the minimum percentage on the server; never trust the browser.
  const { data: minRow } = await admin.from("app_settings").select("value").eq("key", "min_charity_bps").maybeSingle();
  const minBps = Number(minRow?.value ?? 1000);
  if (bps < minBps || bps > 10000) return { ok: false, errors: { charityPercent: `Choose between ${minBps / 100}% and 100%.` } };
  const { data: charity } = await supabase.from("charities").select("id, name").eq("id", parsed.data.charityId).eq("status", "active").maybeSingle();
  if (!charity) return { ok: false, errors: { charityId: "That charity isn't available any more." } };

  await supabase.from("profiles").update({ display_name: parsed.data.displayName, terms_accepted_at: new Date().toISOString(), terms_version: TERMS_VERSION, onboarding_completed_at: new Date().toISOString() }).eq("id", actor.id);

  const { data: existing } = await admin.from("subscriptions").select("status, stripe_customer_id").eq("user_id", actor.id).maybeSingle();
  if (existing && ["active", "canceling", "past_due"].includes(existing.status)) redirect("/app/billing");

  const { data: plan } = await admin.from("plans").select("id, name, interval, amount_minor, stripe_price_id").eq("id", parsed.data.plan).eq("is_active", true).maybeSingle();
  if (!plan) return { ok: false, errors: { plan: "That plan isn't available." } };

  const stripe = getStripe();
  let customerId = existing?.stripe_customer_id ?? null;
  if (!customerId) customerId = (await stripe.customers.create({ email: session!.profile.email, name: parsed.data.displayName, metadata: { user_id: actor.id } })).id;

  const meta = { user_id: actor.id, plan: plan.id, interval: plan.interval, charity_id: charity.id, charity_bps: String(bps) };
  const envPrice = plan.id === "yearly" ? serverEnv.stripePriceYearly() : serverEnv.stripePriceMonthly();
  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: actor.id,
    line_items: [envPrice
      ? { price: envPrice, quantity: 1 }
      : { quantity: 1, price_data: { currency: "inr", unit_amount: Number(plan.amount_minor), recurring: { interval: plan.interval as "month" | "year" }, product_data: { name: `Digital Heroes ${plan.name}` } } }],
    metadata: meta,
    subscription_data: { metadata: meta },
    success_url: `${publicEnv.siteUrl}/app?checkout=success`,
    cancel_url: `${publicEnv.siteUrl}/onboarding?canceled=1`,
  });
  if (!checkout.url) return { ok: false, message: "Stripe didn't return a checkout link. Please try again." };
  redirect(checkout.url);
}

export async function openBillingPortal() {
  const session = await getSession();
  const actor = requireActor(session?.actor);
  const { data } = await createAdminClient().from("subscriptions").select("stripe_customer_id").eq("user_id", actor.id).maybeSingle();
  if (!data?.stripe_customer_id || !isStripeConfigured()) redirect("/app/billing?portal=unavailable");
  const portal = await getStripe().billingPortal.sessions.create({ customer: data.stripe_customer_id, return_url: `${publicEnv.siteUrl}/app/billing` });
  redirect(portal.url);
}

/** Schedules cancellation at period end. Our status flips only when Stripe's webhook confirms it. */
export async function setCancelAtPeriodEnd(formData: FormData) {
  const session = await getSession();
  const actor = requireActor(session?.actor);
  const cancel = formData.get("cancel") === "true";
  const { data } = await createAdminClient().from("subscriptions").select("stripe_subscription_id, status").eq("user_id", actor.id).maybeSingle();
  if (!data?.stripe_subscription_id || !isStripeConfigured()) redirect("/app/billing?portal=unavailable");
  if (!["active", "canceling"].includes(data.status)) redirect("/app/billing");
  await getStripe().subscriptions.update(data.stripe_subscription_id, { cancel_at_period_end: cancel });
  redirect("/app/billing?updated=1");
}
