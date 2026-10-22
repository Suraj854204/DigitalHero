
/**
 * Stripe webhook event handling.
 *
 * Guarantees:
 * - Stripe signature must be verified before this handler is called.
 * - Duplicate Stripe events do not double-record payments.
 * - Payment postings are idempotent by invoice ID in the database.
 * - Subscription states are applied only from verified Stripe events.
 * - Out-of-order events are checked against the last applied event timestamp.
 */
import Stripe from "stripe";
import {
  shouldApplyProviderEvent,
  type SubscriptionStatus,
} from "../draw-engine/state.ts";

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

export function verifyWebhook(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): StripeEventLike {
  if (!signatureHeader) {
    throw new WebhookSignatureError("Missing stripe-signature header");
  }

  if (!secret) {
    throw new WebhookSignatureError("Webhook secret is not configured");
  }

  try {
    return Stripe.webhooks.constructEvent(
      rawBody,
      signatureHeader,
      secret,
    ) as unknown as StripeEventLike;
  } catch {
    throw new WebhookSignatureError();
  }
}

export function mapStripeStatus(
  status: string,
  cancelAtPeriodEnd: boolean,
): SubscriptionStatus {
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
  subscriptionId: string;
  userId: string;
  interval: "month" | "year";
  status: SubscriptionStatus;
  lastEventCreated: number | null;
}

export interface WebhookStore {
  claimEvent(
    eventId: string,
    type: string,
    created: number,
  ): Promise<boolean>;

  markProcessed(eventId: string): Promise<void>;
  markFailed(eventId: string, error: string): Promise<void>;

  linkCheckout(input: {
    userId: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    interval: "month" | "year";
    charityBps: number;
    charityId: string | null;
  }): Promise<void>;

  getContextByStripeSubscription(
    stripeSubscriptionId: string,
  ): Promise<SubscriptionContext | null>;

  applySubscriptionState(input: {
    subscriptionId: string;
    status: SubscriptionStatus;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    eventCreated: number;
  }): Promise<void>;

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

const iso = (seconds: number | null | undefined): string | null =>
  typeof seconds === "number"
    ? new Date(seconds * 1000).toISOString()
    : null;

function getStripeSubscriptionId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string"
  ) {
    return value.id;
  }

  return null;
}

export async function handleStripeEvent(
  event: StripeEventLike,
  store: WebhookStore,
): Promise<HandleOutcome> {
  const isNew = await store.claimEvent(
    event.id,
    event.type,
    event.created,
  );

  if (!isNew) {
    return "duplicate";
  }

  try {
    const outcome = await dispatch(event, store);
    await store.markProcessed(event.id);
    return outcome;
  } catch (error) {
    try {
      await store.markFailed(
        event.id,
        (error instanceof Error ? error.message : "Unknown error").slice(
          0,
          500,
        ),
      );
    } catch {
      // Preserve the original processing error so Stripe receives a failure.
    }

    throw error;
  }
}

async function dispatch(
  event: StripeEventLike,
  store: WebhookStore,
): Promise<HandleOutcome> {
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      const userId = obj.client_reference_id ?? obj.metadata?.user_id;
      const stripeSubscriptionId = getStripeSubscriptionId(obj.subscription);
      const stripeCustomerId = getStripeSubscriptionId(obj.customer);

      if (!userId || !stripeCustomerId || !stripeSubscriptionId) {
        return "ignored";
      }

      await store.linkCheckout({
        userId: String(userId),
        stripeCustomerId,
        stripeSubscriptionId,
        interval: obj.metadata?.interval === "year" ? "year" : "month",
        charityBps: Number.parseInt(obj.metadata?.charity_bps ?? "1000", 10),
        charityId: obj.metadata?.charity_id ?? null,
      });

      /*
       * Do not blindly activate a subscription from checkout completion.
       * A completed session may have delayed payment or a trial.
       * The subscription's verified Stripe event is authoritative.
       *
       * If the subscription event arrived first, it may have been ignored
       * before linkCheckout. In that case, a later Stripe subscription event
       * or a separate reconciliation must sync the current provider state.
       */
      return "processed";
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const ctx = await store.getContextByStripeSubscription(String(obj.id));

      /*
       * Throw instead of acknowledging an unlinked subscription. This allows
       * Stripe to retry. The claim_webhook_event SQL function must permit
       * retrying a previously failed event; verify that behavior before deploy.
       */
      if (!ctx) {
        throw new Error(
          `Subscription ${String(obj.id)} is not linked yet; retry required`,
        );
      }

      if (!shouldApplyProviderEvent(ctx.lastEventCreated, event.created)) {
        return "ignored";
      }

      const status: SubscriptionStatus =
        event.type === "customer.subscription.deleted"
          ? "canceled"
          : mapStripeStatus(
              String(obj.status),
              Boolean(obj.cancel_at_period_end),
            );

      await store.applySubscriptionState({
        subscriptionId: ctx.subscriptionId,
        status,
        currentPeriodStart: iso(
          obj.current_period_start ??
            obj.items?.data?.[0]?.current_period_start,
        ),
        currentPeriodEnd: iso(
          obj.current_period_end ??
            obj.items?.data?.[0]?.current_period_end,
        ),
        cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
        eventCreated: event.created,
      });

      return "processed";
    }

    case "invoice.paid": {
      const stripeSub = getStripeSubscriptionId(
        obj.subscription ??
          obj.parent?.subscription_details?.subscription,
      );

      if (!stripeSub) {
        return "ignored";
      }

      const ctx = await store.getContextByStripeSubscription(stripeSub);

      if (!ctx) {
        throw new Error(
          `Paid invoice ${String(obj.id)} belongs to an unlinked subscription`,
        );
      }

      const amountMinor = Number(obj.amount_paid);

      if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
        throw new Error("Invalid invoice amount_paid");
      }

      if (amountMinor === 0) {
        return "ignored";
      }

      const paidAt = iso(
        obj.status_transitions?.paid_at ?? event.created,
      )!;

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

      if (shouldApplyProviderEvent(ctx.lastEventCreated, event.created)) {
        await store.applySubscriptionState({
          subscriptionId: ctx.subscriptionId,
          status: ctx.status === "canceling" ? "canceling" : "active",
          currentPeriodStart: iso(
            obj.period_start ?? obj.lines?.data?.[0]?.period?.start,
          ),
          currentPeriodEnd: iso(
            obj.period_end ?? obj.lines?.data?.[0]?.period?.end,
          ),
          cancelAtPeriodEnd: ctx.status === "canceling",
          eventCreated: event.created,
        });
      }

      return "processed";
    }

    case "invoice.payment_failed": {
      const stripeSub = getStripeSubscriptionId(
        obj.subscription ??
          obj.parent?.subscription_details?.subscription,
      );

      if (!stripeSub) {
        return "ignored";
      }

      const ctx = await store.getContextByStripeSubscription(stripeSub);

      if (!ctx) {
        throw new Error(
          `Failed invoice ${String(obj.id)} belongs to an unlinked subscription`,
        );
      }

      if (!shouldApplyProviderEvent(ctx.lastEventCreated, event.created)) {
        return "ignored";
      }

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
