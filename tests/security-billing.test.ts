import { test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import {
  AuthorizationError,
  canViewEvidence,
  evidencePathBelongsTo,
  requireActor,
  requireAdmin,
  requireOwnerOrAdmin,
  type Actor,
} from "../src/lib/authz.ts";
import {
  TransitionError,
  assertClaimTransition,
  assertSubscriptionTransition,
  canTransitionClaim,
  canTransitionSubscription,
  shouldApplyProviderEvent,
  type SubscriptionStatus,
} from "../src/lib/draw-engine/index.ts";
import {
  WebhookSignatureError,
  handleStripeEvent,
  mapStripeStatus,
  verifyWebhook,
  type StripeEventLike,
  type SubscriptionContext,
  type WebhookStore,
} from "../src/lib/stripe/events.ts";

const sub: Actor = { id: "u1", role: "subscriber" };
const other: Actor = { id: "u2", role: "subscriber" };
const admin: Actor = { id: "a1", role: "admin" };

/* ------------------------------ authorization --------------------------- */
test("unauthorized admin actions are rejected (anonymous, subscriber, suspended admin)", () => {
  assert.throws(() => requireAdmin(null), (e: unknown) => e instanceof AuthorizationError && e.status === 401);
  assert.throws(() => requireAdmin(undefined), AuthorizationError);
  assert.throws(() => requireAdmin(sub), (e: unknown) => e instanceof AuthorizationError && e.status === 403);
  assert.throws(() => requireAdmin({ ...admin, suspended: true }), /suspended/);
  assert.equal(requireAdmin(admin).id, "a1");
});

test("owner-or-admin: a subscriber cannot touch another user's record", () => {
  assert.equal(requireOwnerOrAdmin(sub, "u1").id, "u1");
  assert.equal(requireOwnerOrAdmin(admin, "u1").id, "a1");
  assert.throws(() => requireOwnerOrAdmin(other, "u1"), AuthorizationError);
  assert.throws(() => requireActor(null), AuthorizationError);
});

test("evidence access is restricted to the owner and admins", () => {
  assert.equal(canViewEvidence(sub, "u1"), true);
  assert.equal(canViewEvidence(admin, "u1"), true);
  assert.equal(canViewEvidence(other, "u1"), false);
  assert.equal(canViewEvidence(null, "u1"), false);
  assert.equal(canViewEvidence({ ...sub, suspended: true }, "u1"), false);
});

test("evidence storage paths must live under the owner's own folder and cannot traverse", () => {
  assert.equal(evidencePathBelongsTo("u1/claim9/shot.png", "u1"), true);
  assert.equal(evidencePathBelongsTo("u2/claim9/shot.png", "u1"), false);
  assert.equal(evidencePathBelongsTo("u1/../u2/claim9/shot.png", "u1"), false);
  assert.equal(evidencePathBelongsTo("u10/claim/x.png", "u1"), false);
});

/* ------------------------------ claim / payout -------------------------- */
test("claim transitions: the happy path is allowed for the right actors", () => {
  assert.equal(canTransitionClaim("not_submitted", "pending_review", "subscriber"), true);
  assert.equal(canTransitionClaim("pending_review", "approved", "admin"), true);
  assert.equal(canTransitionClaim("pending_review", "rejected", "admin"), true);
  assert.equal(canTransitionClaim("rejected", "pending_review", "subscriber"), true); // resubmission
  assert.equal(canTransitionClaim("approved", "payout_pending", "admin"), true);
  assert.equal(canTransitionClaim("payout_pending", "paid", "admin"), true);
});

test("a subscriber can never approve or pay their own winnings", () => {
  for (const [from, to] of [
    ["pending_review", "approved"],
    ["approved", "payout_pending"],
    ["payout_pending", "paid"],
    ["not_submitted", "paid"],
    ["rejected", "approved"],
  ] as const) {
    assert.equal(canTransitionClaim(from, to, "subscriber"), false, `${from}->${to}`);
    assert.throws(() => assertClaimTransition(from, to, "subscriber"), TransitionError);
  }
});

test("payout transitions cannot skip verification or move backwards", () => {
  assert.equal(canTransitionClaim("not_submitted", "approved", "admin"), false);
  assert.equal(canTransitionClaim("pending_review", "paid", "admin"), false);
  assert.equal(canTransitionClaim("approved", "paid", "admin"), false);
  assert.equal(canTransitionClaim("paid", "payout_pending", "admin"), false);
  assert.equal(canTransitionClaim("paid", "pending_review", "subscriber"), false);
  assert.equal(canTransitionClaim("approved", "rejected", "admin"), false);
});

/* ------------------------------ subscription ---------------------------- */
test("subscription state transitions are validated", () => {
  const ok: [SubscriptionStatus, SubscriptionStatus][] = [
    ["incomplete", "active"],
    ["active", "canceling"],
    ["canceling", "active"],
    ["active", "past_due"],
    ["past_due", "active"],
    ["past_due", "lapsed"],
    ["lapsed", "active"],
    ["canceled", "active"],
    ["active", "active"],
  ];
  for (const [a, b] of ok) assert.equal(canTransitionSubscription(a, b), true, `${a}->${b}`);
  const bad: [SubscriptionStatus, SubscriptionStatus][] = [
    ["incomplete", "lapsed"],
    ["active", "lapsed"],
    ["canceled", "past_due"],
    ["lapsed", "canceling"],
  ];
  for (const [a, b] of bad) assert.equal(canTransitionSubscription(a, b), false, `${a}->${b}`);
  assert.throws(() => assertSubscriptionTransition("canceled", "past_due"), TransitionError);
});

test("out-of-order provider events are detected", () => {
  assert.equal(shouldApplyProviderEvent(null, 100), true);
  assert.equal(shouldApplyProviderEvent(100, 101), true);
  assert.equal(shouldApplyProviderEvent(100, 100), true);
  assert.equal(shouldApplyProviderEvent(100, 99), false);
});

test("Stripe status mapping covers every provider status", () => {
  assert.equal(mapStripeStatus("active", false), "active");
  assert.equal(mapStripeStatus("trialing", false), "active");
  assert.equal(mapStripeStatus("active", true), "canceling");
  assert.equal(mapStripeStatus("past_due", false), "past_due");
  assert.equal(mapStripeStatus("unpaid", false), "lapsed");
  assert.equal(mapStripeStatus("paused", false), "lapsed");
  assert.equal(mapStripeStatus("canceled", false), "canceled");
  assert.equal(mapStripeStatus("incomplete_expired", false), "canceled");
  assert.equal(mapStripeStatus("incomplete", false), "incomplete");
});

/* ------------------------------ webhook signature ----------------------- */
const SECRET = "whsec_test_secret_for_unit_tests_only";
const body = JSON.stringify({ id: "evt_1", object: "event", type: "invoice.paid", created: 1_700_000_000, data: { object: {} } });

test("webhook: a correctly signed payload is accepted", () => {
  const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET });
  const evt = verifyWebhook(body, header, SECRET);
  assert.equal(evt.id, "evt_1");
});

test("webhook: invalid signatures are rejected (wrong secret, tampered body, missing header, stale timestamp)", () => {
  const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET });
  assert.throws(() => verifyWebhook(body, header, "whsec_other"), WebhookSignatureError);
  assert.throws(() => verifyWebhook(body.replace("evt_1", "evt_2"), header, SECRET), WebhookSignatureError);
  assert.throws(() => verifyWebhook(body, null, SECRET), /Missing/);
  assert.throws(() => verifyWebhook(body, "t=1,v1=deadbeef", SECRET), WebhookSignatureError);
  assert.throws(() => verifyWebhook(body, header, ""), /not configured/);
  const stale = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: SECRET,
    timestamp: Math.floor(Date.now() / 1000) - 3600,
  });
  assert.throws(() => verifyWebhook(body, stale, SECRET), WebhookSignatureError);
});

/* ------------------------------ webhook processing ---------------------- */
class MemStore implements WebhookStore {
  seen = new Map<string, { type: string; status: "claimed" | "processed" | "failed"; error?: string }>();
  subs = new Map<
    string,
    { ctx: SubscriptionContext; period?: [string | null, string | null]; cancelAtPeriodEnd?: boolean }
  >();
  postedInvoices = new Set<string>();
  monthly: unknown[] = [];
  annual: unknown[] = [];
  linked: unknown[] = [];
  async claimEvent(id: string, type: string) {
    if (this.seen.has(id)) return false;
    this.seen.set(id, { type, status: "claimed" });
    return true;
  }
  async markProcessed(id: string) {
    this.seen.get(id)!.status = "processed";
  }
  async markFailed(id: string, error: string) {
    Object.assign(this.seen.get(id)!, { status: "failed", error });
  }
  async linkCheckout(input: Parameters<WebhookStore["linkCheckout"]>[0]) {
    this.linked.push(input);
    this.subs.set(input.stripeSubscriptionId, {
      ctx: {
        subscriptionId: `row-${input.stripeSubscriptionId}`,
        userId: input.userId,
        interval: input.interval,
        status: "incomplete",
        lastEventCreated: null,
      },
    });
  }
  async getContextByStripeSubscription(id: string) {
    return this.subs.get(id)?.ctx ?? null;
  }
  async applySubscriptionState(i: Parameters<WebhookStore["applySubscriptionState"]>[0]) {
    const s = [...this.subs.values()].find((x) => x.ctx.subscriptionId === i.subscriptionId)!;
    s.ctx = { ...s.ctx, status: i.status, lastEventCreated: i.eventCreated };
    s.cancelAtPeriodEnd = i.cancelAtPeriodEnd;
  }
  async postMonthlyPayment(i: Parameters<WebhookStore["postMonthlyPayment"]>[0]) {
    if (this.postedInvoices.has(i.invoiceId)) return false;
    this.postedInvoices.add(i.invoiceId);
    this.monthly.push(i);
    return true;
  }
  async postAnnualPayment(i: Parameters<WebhookStore["postAnnualPayment"]>[0]) {
    if (this.postedInvoices.has(i.invoiceId)) return false;
    this.postedInvoices.add(i.invoiceId);
    this.annual.push(i);
    return true;
  }
}

const evt = (id: string, type: string, created: number, object: Record<string, unknown>): StripeEventLike => ({
  id,
  type,
  created,
  data: { object },
});

const checkout = (interval: "month" | "year" = "month") =>
  evt("evt_co", "checkout.session.completed", 1000, {
    client_reference_id: "user-1",
    customer: "cus_1",
    subscription: "sub_1",
    metadata: { interval, charity_bps: "1500", charity_id: "ch-1" },
  });

test("webhook: duplicate event ids are processed exactly once", async () => {
  const store = new MemStore();
  assert.equal(await handleStripeEvent(checkout(), store), "processed");
  assert.equal(await handleStripeEvent(checkout(), store), "duplicate");
  assert.equal(store.linked.length, 1);
  const paid = evt("evt_paid", "invoice.paid", 1001, { id: "in_1", subscription: "sub_1", amount_paid: 99_900 });
  assert.equal(await handleStripeEvent(paid, store), "processed");
  assert.equal(await handleStripeEvent(paid, store), "duplicate");
  assert.equal(await handleStripeEvent(paid, store), "duplicate");
  assert.equal(store.monthly.length, 1);
});

test("webhook: the same invoice delivered under a different event id still posts money once", async () => {
  const store = new MemStore();
  await handleStripeEvent(checkout(), store);
  const mk = (id: string) => evt(id, "invoice.paid", 1001, { id: "in_1", subscription: "sub_1", amount_paid: 99_900 });
  await handleStripeEvent(mk("evt_a"), store);
  await handleStripeEvent(mk("evt_b"), store);
  assert.equal(store.monthly.length, 1);
});

test("webhook: activation comes from verified events only; checkout.completed alone does not activate", async () => {
  const store = new MemStore();
  await handleStripeEvent(checkout(), store);
  assert.equal(store.subs.get("sub_1")!.ctx.status, "incomplete");
  await handleStripeEvent(evt("e2", "invoice.paid", 1001, { id: "in_1", subscription: "sub_1", amount_paid: 99_900 }), store);
  assert.equal(store.subs.get("sub_1")!.ctx.status, "active");
});

test("webhook: monthly invoices post the paid amount once (splitting is SQL-authoritative, see db tests)", async () => {
  const store = new MemStore();
  await handleStripeEvent(checkout("month"), store);
  await handleStripeEvent(evt("e2", "invoice.paid", 1001, { id: "in_1", subscription: "sub_1", amount_paid: 100_000 }), store);
  const posted = store.monthly[0] as { amountMinor: number; invoiceId: string; userId: string };
  assert.equal(posted.amountMinor, 100_000);
  assert.equal(posted.invoiceId, "in_1");
  assert.equal(posted.userId, "user-1");
  assert.equal(store.annual.length, 0);
});

test("webhook: annual invoices go to the deferred-revenue path, not the immediate split", async () => {
  const store = new MemStore();
  await handleStripeEvent(checkout("year"), store);
  await handleStripeEvent(evt("e2", "invoice.paid", 1001, { id: "in_9", subscription: "sub_1", amount_paid: 999_999 }), store);
  assert.equal(store.monthly.length, 0);
  assert.equal(store.annual.length, 1);
  assert.equal((store.annual[0] as { amountMinor: number }).amountMinor, 999_999);
});

test("webhook: out-of-order subscription events do not regress state", async () => {
  const store = new MemStore();
  await handleStripeEvent(checkout(), store);
  await handleStripeEvent(evt("e_new", "customer.subscription.updated", 2000, { id: "sub_1", status: "past_due" }), store);
  assert.equal(store.subs.get("sub_1")!.ctx.status, "past_due");
  // an OLDER 'active' update arrives late: must be ignored
  const r = await handleStripeEvent(evt("e_old", "customer.subscription.updated", 1500, { id: "sub_1", status: "active" }), store);
  assert.equal(r, "ignored");
  assert.equal(store.subs.get("sub_1")!.ctx.status, "past_due");
});

test("webhook: scheduled cancellation, payment failure, lapse and deletion", async () => {
  const store = new MemStore();
  await handleStripeEvent(checkout(), store);
  await handleStripeEvent(evt("a", "customer.subscription.updated", 2000, { id: "sub_1", status: "active", cancel_at_period_end: true }), store);
  assert.equal(store.subs.get("sub_1")!.ctx.status, "canceling");
  // a renewal invoice for a canceling subscription must not silently un-cancel it
  await handleStripeEvent(evt("b", "invoice.paid", 2001, { id: "in_2", subscription: "sub_1", amount_paid: 1000 }), store);
  assert.equal(store.subs.get("sub_1")!.ctx.status, "canceling");
  await handleStripeEvent(evt("c", "invoice.payment_failed", 2002, { subscription: "sub_1" }), store);
  assert.equal(store.subs.get("sub_1")!.ctx.status, "past_due");
  await handleStripeEvent(evt("d", "customer.subscription.updated", 2003, { id: "sub_1", status: "unpaid" }), store);
  assert.equal(store.subs.get("sub_1")!.ctx.status, "lapsed");
  await handleStripeEvent(evt("e", "customer.subscription.deleted", 2004, { id: "sub_1", status: "canceled" }), store);
  assert.equal(store.subs.get("sub_1")!.ctx.status, "canceled");
});

test("webhook: unknown event types are acknowledged and ignored; failures are recorded and re-thrown", async () => {
  const store = new MemStore();
  assert.equal(await handleStripeEvent(evt("x", "charge.dispute.created", 1, {}), store), "ignored");
  // invoice.paid for a subscription we never linked -> throws so Stripe retries, row marked failed
  await assert.rejects(
    handleStripeEvent(evt("y", "invoice.paid", 2, { id: "in_z", subscription: "sub_missing", amount_paid: 5 }), store),
    /unlinked/,
  );
  assert.equal(store.seen.get("y")!.status, "failed");
});

test("webhook: zero or invalid amounts never post money", async () => {
  const store = new MemStore();
  await handleStripeEvent(checkout(), store);
  assert.equal(await handleStripeEvent(evt("z0", "invoice.paid", 5, { id: "in_0", subscription: "sub_1", amount_paid: 0 }), store), "ignored");
  await assert.rejects(handleStripeEvent(evt("zn", "invoice.paid", 6, { id: "in_n", subscription: "sub_1", amount_paid: 12.5 }), store));
  assert.equal(store.monthly.length, 0);
});
