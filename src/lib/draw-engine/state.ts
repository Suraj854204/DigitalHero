/**
 * State machines for draws, winner claims, payouts and subscriptions.
 * Every server action and SQL function that changes one of these statuses must
 * agree with the tables below (SQL mirrors them in supabase/migrations).
 */
import type { DrawStatus } from "./types.ts";

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransitionError";
  }
}

/* ----------------------------- Draw ----------------------------------- */
/**
 * draft ──simulate──▶ simulated ──approve (freezes snapshot)──▶ approved ──publish──▶ published (terminal)
 *   ▲                    │  ▲                                     │
 *   └────────reset───────┘  └──────────unapprove (pre-publish)────┘
 * cancelled is reachable from any non-published state and is terminal.
 */
const DRAW_TRANSITIONS: Record<DrawStatus, readonly DrawStatus[]> = {
  draft: ["simulated", "cancelled"],
  simulated: ["simulated", "draft", "approved", "cancelled"],
  approved: ["simulated", "published", "cancelled"],
  published: [],
  cancelled: [],
};

export function canTransitionDraw(from: DrawStatus, to: DrawStatus): boolean {
  return DRAW_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertDrawTransition(from: DrawStatus, to: DrawStatus): void {
  if (!canTransitionDraw(from, to)) {
    throw new TransitionError(`draw cannot move from "${from}" to "${to}"`);
  }
}

/* --------------------------- Winner claim ----------------------------- */
export type ClaimStatus = "not_submitted" | "pending_review" | "rejected" | "approved" | "payout_pending" | "paid";
export type ActorRole = "subscriber" | "admin" | "system";

interface ClaimRule {
  to: ClaimStatus;
  roles: readonly ActorRole[];
}

const CLAIM_RULES: Record<ClaimStatus, readonly ClaimRule[]> = {
  not_submitted: [{ to: "pending_review", roles: ["subscriber"] }],
  pending_review: [
    { to: "approved", roles: ["admin"] },
    { to: "rejected", roles: ["admin"] },
  ],
  rejected: [{ to: "pending_review", roles: ["subscriber"] }],
  approved: [{ to: "payout_pending", roles: ["admin"] }],
  payout_pending: [{ to: "paid", roles: ["admin"] }],
  paid: [],
};

export function canTransitionClaim(from: ClaimStatus, to: ClaimStatus, role: ActorRole): boolean {
  return (CLAIM_RULES[from] ?? []).some((r) => r.to === to && r.roles.includes(role));
}

export function assertClaimTransition(from: ClaimStatus, to: ClaimStatus, role: ActorRole): void {
  if (!canTransitionClaim(from, to, role)) {
    throw new TransitionError(`${role} cannot move a claim from "${from}" to "${to}"`);
  }
}

/* --------------------------- Subscription ----------------------------- */
export type SubscriptionStatus = "incomplete" | "active" | "canceling" | "past_due" | "lapsed" | "canceled";

const SUB_TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  incomplete: ["active", "canceled"],
  active: ["canceling", "past_due", "canceled"],
  canceling: ["active", "canceled"],
  past_due: ["active", "lapsed", "canceled"],
  lapsed: ["active", "canceled"],
  canceled: ["active"], // re-subscription via a fresh verified payment
};

export function canTransitionSubscription(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return from === to || (SUB_TRANSITIONS[from]?.includes(to) ?? false);
}

export function assertSubscriptionTransition(from: SubscriptionStatus, to: SubscriptionStatus): void {
  if (!canTransitionSubscription(from, to)) {
    throw new TransitionError(`subscription cannot move from "${from}" to "${to}"`);
  }
}

/** Out-of-order webhook guard: apply an event only if it is newer than what we already applied. */
export function shouldApplyProviderEvent(lastAppliedCreated: number | null, eventCreated: number): boolean {
  return lastAppliedCreated === null || eventCreated >= lastAppliedCreated;
}
