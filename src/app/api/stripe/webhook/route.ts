import { NextResponse } from "next/server";
import { isServiceRoleConfigured, isSupabaseConfigured, serverEnv } from "@/lib/env";
import { handleStripeEvent, verifyWebhook, WebhookSignatureError } from "@/lib/stripe/events";
import { createSupabaseWebhookStore } from "@/lib/stripe/store";

export const runtime = "nodejs"; // Stripe signature verification needs the raw body and Node crypto
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // 1. Read the RAW body: JSON re-serialisation would break the signature.
  const raw = await req.text();
  let event;
  try {
    event = verifyWebhook(raw, req.headers.get("stripe-signature"), serverEnv.stripeWebhookSecret());
  } catch (e) {
    if (e instanceof WebhookSignatureError) return NextResponse.json({ error: "invalid signature" }, { status: 400 });
    throw e;
  }
  if (!isSupabaseConfigured() || !isServiceRoleConfigured()) return NextResponse.json({ error: "server not configured" }, { status: 503 });

  try {
    const outcome = await handleStripeEvent(event, createSupabaseWebhookStore());
    return NextResponse.json({ received: true, outcome });
  } catch {
    // Non-2xx makes Stripe retry; the failed event row is re-claimable (see claim_webhook_event).
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
