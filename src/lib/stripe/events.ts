/**
 * Stripe webhook event handling: pure orchestration over store ports.
 *
 * GUARANTEES
 *  - Signature is verified BEFORE any parsing (see `verifyWebhook`).
 *  - Every event id is claimed exactly once (`claimEvent` is backed by a UNIQUE
 *    constraint on webhook_events.stripe_event_id); a replay is acknowledged
 *    with 200 and does nothing, so retries never double-record money.
 *  - Money postings are additionally idempotent on the invoice id.
 *  - Out-of-order delivery: a subscription event older than the last one applied
 *    for that subscription is ignored (`shouldApplyProviderEvent`).
 *  - Activation happens ONLY from verified events, never from the success URL.
 */
import Stripe from "stripe";
import { shouldApplyProviderEvent, type SubscriptionStatus } from "../draw-engine/state.ts";

export interface StripeEventLike {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, any> };
}

export class WebhookSignatureError extends Error {
  constructor(message = "Invalid webhook signature") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

/** Verify the signature over the RAW body. Throws WebhookSignatureError on any failure. */
export function verifyWebhook(rawBody: string, signatureHeader: string | null, secret: string): StripeEventLike {
  if (!signatureHeader) throw new WebhookSignatureError("Missing stripe-signature header");
  if (!secret) throw new WebhookSignatureError("Webhook secret is not configured");
  try {
    return Stripe.webhooks.constructEvent(rawBody, signatureHeader, secret) as unknown as StripeEventLike;
  } catch {
    // Deliberately do not echo provider internals (they can include payload hints).
    throw new WebhookSignatureError();
  }
}

export function mapStripeStatus(status: string, cancelAtPeriodEnd: boolean): SubscriptionStatus {
  switch (status) {
    case "active":
    case "trialing":
      return cancelAtPeriodEnd ? "canceling" : "active";
    case "past_due":
      return "past_due";
    case "unpaid":
    case "paused":
      return "lapsed";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "incomplete";
  }
}

export interface SubscriptionContext {
  subscriptionId: string; // our row id
  userId: string;
  interval: "month" | "year";
  /** Current stored status; lets invoice.paid avoid un-scheduling a pending cancellation. */
  status: SubscriptionStatus;
  lastEventCreated: number | null;
}

export interface WebhookStore {
  /** Insert the event id; true if newly claimed, false if it was already seen. */
  claimEvent(eventId: string, type: string, created: number): Promise<boolean>;
  markProcessed(eventId: string): Promise<void>;
  markFailed(eventId: string, error: string): Promise<void>;
  /** Associate Stripe ids with the user named in OUR metadata (set server-side at checkout creation). */
  linkCheckout(input: {
    userId: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    interval: "month" | "year";
    charityBps: number;
    charityId: string | null;
  }): Promise<void>;
  getContextByStripeSubscription(stripeSubscriptionId: string): Promise<SubscriptionContext | null>;
  applySubscriptionState(input: {
    subscriptionId: string;
    status: SubscriptionStatus;
    /** null period values mean "keep what is stored". */
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    eventCreated: number;
  }): Promise<void>;
  /**
   * Money posting is SQL-authoritative (public.post_monthly_payment / post_annual_payment):
   * the database splits the payment into charity / prize pool / platform using the settings and
   * charity selection in force at posting time, and is idempotent on the invoice id. Returns
   * false if this invoice was already posted.
   */
  postMonthlyPayment(input: {
    invoiceId: string;
    userId: string;
    subscriptionId: string;
    amountMinor: number;
    paidAt: string;
  }): Promise<boolean>;
  postAnnualPayment(input: {
    invoiceId: string;
    userId: string;
    subscriptionId: string;
    amountMinor: number;
    paidAt: string;
  }): Promise<boolean>;
}

export type HandleOutcome = "duplicate" | "processed" | "ignored";

const iso = (unixSeconds: number | null | undefined) =>
  typeof unixSeconds === "number" ? new Date(unixSeconds * 1000).toISOString() : null;

export async function handleStripeEvent(event: StripeEventLike, store: WebhookStore): Promise<HandleOutcome> {
  const isNew = await store.claimEvent(event.id, event.type, event.created);
  if (!isNew) return "duplicate";

  try {
    const outcome = await dispatch(event, store);
    await store.markProcessed(event.id);
    return outcome;
  } catch (e) {
    await store.markFailed(event.id, (e as Error).message.slice(0, 500));
    throw e; // non-2xx so Stripe retries; the claimed row is marked failed and can be replayed by an admin
  }
}

async function dispatch(event: StripeEventLike, store: WebhookStore): Promise<HandleOutcome> {
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed": {
      const userId = obj.client_reference_id ?? obj.metadata?.user_id;
      if (!userId || !obj.customer || !obj.subscription) return "ignored";
      await store.linkCheckout({
        userId,
        stripeCustomerId: String(obj.customer),
        stripeSubscriptionId: String(obj.subscription),
        interval: obj.metadata?.interval === "year" ? "year" : "month",
        charityBps: Number.parseInt(obj.metadata?.charity_bps ?? "1000", 10),
        charityId: obj.metadata?.charity_id ?? null,
      });
      return "processed";
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const ctx = await store.getContextByStripeSubscription(String(obj.id));
      if (!ctx) return "ignored"; // checkout link not recorded yet; Stripe will retry the later events too
      if (!shouldApplyProviderEvent(ctx.lastEventCreated, event.created)) return "ignored";
      const status =
        event.type === "customer.subscription.deleted"
          ? "canceled"
          : mapStripeStatus(String(obj.status), Boolean(obj.cancel_at_period_end));
      await store.applySubscriptionState({
        subscriptionId: ctx.subscriptionId,
        status,
        currentPeriodStart: iso(obj.current_period_start ?? obj.items?.data?.[0]?.current_period_start),
        currentPeriodEnd: iso(obj.current_period_end ?? obj.items?.data?.[0]?.current_period_end),
        cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
        eventCreated: event.created,
      });
      return "processed";
    }
    case "invoice.paid": {
      const stripeSub = obj.subscription ?? obj.parent?.subscription_details?.subscription;
      if (!stripeSub) return "ignored";
      const ctx = await store.getContextByStripeSubscription(String(stripeSub));
      if (!ctx) throw new Error("invoice.paid for an unlinked subscription; will retry");
      const amountMinor = Number(obj.amount_paid);
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error("invalid amount_paid");
      if (amountMinor === 0) return "ignored";
      const paidAt = iso(obj.status_transitions?.paid_at ?? event.created)!;
      if (ctx.interval === "year") {
        await store.postAnnualPayment({
          invoiceId: String(obj.id),
          userId: ctx.userId,
          subscriptionId: ctx.subscriptionId,
          amountMinor,
          paidAt,
        });
      } else {
        await store.postMonthlyPayment({
          invoiceId: String(obj.id),
          userId: ctx.userId,
          subscriptionId: ctx.subscriptionId,
          amountMinor,
          paidAt,
        });
      }
      // Access state is applied from the customer.subscription.* events; a paid invoice
      // for a past_due subscription also reactivates it.
      if (shouldApplyProviderEvent(ctx.lastEventCreated, event.created)) {
        await store.applySubscriptionState({
          subscriptionId: ctx.subscriptionId,
          status: ctx.status === "canceling" ? "canceling" : "active",
          currentPeriodStart: iso(obj.period_start ?? obj.lines?.data?.[0]?.period?.start),
          currentPeriodEnd: iso(obj.period_end ?? obj.lines?.data?.[0]?.period?.end),
          cancelAtPeriodEnd: ctx.status === "canceling",
          eventCreated: event.created,
        });
      }
      return "processed";
    }
    case "invoice.payment_failed": {
      const stripeSub = obj.subscription ?? obj.parent?.subscription_details?.subscription;
      if (!stripeSub) return "ignored";
      const ctx = await store.getContextByStripeSubscription(String(stripeSub));
      if (!ctx || !shouldApplyProviderEvent(ctx.lastEventCreated, event.created)) return "ignored";
      await store.applySubscriptionState({
        subscriptionId: ctx.subscriptionId,
        status: "past_due",
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        eventCreated: event.created,
      });
      return "processed";
    }
    default:
      return "ignored";
  }
}
