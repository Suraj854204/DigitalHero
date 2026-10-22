import "server-only";
import type { SubscriptionStatus } from "../draw-engine/state.ts";
import { createAdminClient } from "../supabase/admin.ts";
import type { SubscriptionContext, WebhookStore } from "./events.ts";

/** Supabase-backed WebhookStore. Every write goes through a SECURITY DEFINER SQL function. */
export function createSupabaseWebhookStore(): WebhookStore {
  const db = createAdminClient();
  const must = async <T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> => {
    const { data, error } = await p;
    if (error) throw new Error(`${what}: ${error.message}`);
    return data;
  };
  return {
    async claimEvent(id, type, created) {
      return Boolean(await must(db.rpc("claim_webhook_event", { p_id: id, p_type: type, p_created: created }), "claim event"));
    },
    async markProcessed(id) {
      await must(db.rpc("finish_webhook_event", { p_id: id, p_status: "processed" }), "finish event");
    },
    async markFailed(id, error) {
      await must(db.rpc("finish_webhook_event", { p_id: id, p_status: "failed", p_error: error }), "finish event");
    },
    async linkCheckout(i) {
      await must(db.rpc("link_checkout", {
        p_user: i.userId, p_customer: i.stripeCustomerId, p_stripe_sub: i.stripeSubscriptionId,
        p_plan: i.interval === "year" ? "yearly" : "monthly", p_charity: i.charityId, p_bps: i.charityBps,
      }), "link checkout");
    },
    async getContextByStripeSubscription(stripeSubId): Promise<SubscriptionContext | null> {
      const { data, error } = await db.from("subscriptions").select("id, user_id, plan_id, status, last_event_created").eq("stripe_subscription_id", stripeSubId).maybeSingle();
      if (error) throw new Error(`load subscription: ${error.message}`);
      if (!data) return null;
      return {
        subscriptionId: data.id, userId: data.user_id, interval: data.plan_id === "yearly" ? "year" : "month",
        status: data.status as SubscriptionStatus, lastEventCreated: data.last_event_created === null ? null : Number(data.last_event_created),
      };
    },
    async applySubscriptionState(i) {
      await must(db.rpc("apply_subscription_state", {
        p_sub: i.subscriptionId, p_status: i.status, p_start: i.currentPeriodStart, p_end: i.currentPeriodEnd,
        p_cancel: i.cancelAtPeriodEnd, p_event: i.eventCreated,
      }), "apply subscription state");
    },
    async postMonthlyPayment(i) {
      return Boolean(await must(db.rpc("post_monthly_payment", { p_invoice: i.invoiceId, p_subscription: i.subscriptionId, p_amount: i.amountMinor, p_paid_at: i.paidAt }), "post monthly payment"));
    },
    async postAnnualPayment(i) {
      return Boolean(await must(db.rpc("post_annual_payment", { p_invoice: i.invoiceId, p_subscription: i.subscriptionId, p_amount: i.amountMinor, p_paid_at: i.paidAt }), "post annual payment"));
    },
  };
}
