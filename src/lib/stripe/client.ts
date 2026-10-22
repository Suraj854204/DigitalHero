import "server-only";
import Stripe from "stripe";
import { isStripeConfigured, serverEnv } from "../env.ts";

let cached: Stripe | null = null;

/** Lazily constructed so builds and pages work without Stripe credentials. */
export function getStripe(): Stripe {
  if (!isStripeConfigured()) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY)");
  cached ??= new Stripe(serverEnv.stripeSecretKey());
  return cached;
}
