
import "server-only";

import { evaluateEligibility } from "../draw-engine/eligibility.ts";
import type { CandidateUser } from "../draw-engine/types.ts";
import { createUserClient } from "../supabase/server.ts";

export interface ScoreRow {
  id: string;
  score_date: string;
  value: number;
  created_at: string;
}

export interface SubscriptionRow {
  id: string;
  plan_id: string;
  status:
    | "incomplete"
    | "active"
    | "canceling"
    | "past_due"
    | "lapsed"
    | "canceled";
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
}

export async function getMyScores(): Promise<ScoreRow[]> {
  const supabase = await createUserClient();

  const { data, error } = await supabase
    .from("scores")
    .select("id, score_date, value, created_at")
    .order("score_date", { ascending: false })
    .limit(5);

  if (error) {
    console.error("Failed to fetch scores:", error.message);
    throw new Error("Unable to load scores.");
  }

  return (data ?? []) as ScoreRow[];
}

export async function getMySubscription(): Promise<SubscriptionRow | null> {
  const supabase = await createUserClient();

  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      "id, plan_id, status, current_period_start, current_period_end, cancel_at_period_end, created_at",
    )
    .maybeSingle();

  if (error) {
    console.error("Failed to fetch subscription:", error.message);
    throw new Error("Unable to load subscription details.");
  }

  return (data as SubscriptionRow | null) ?? null;
}

export async function getMyCharitySelection() {
  const supabase = await createUserClient();

  const { data, error } = await supabase
    .from("charity_selections")
    .select(
      "id, charity_id, contribution_bps, effective_from, charities(id, slug, name, category, is_demo)",
    )
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to fetch charity selection:", error.message);
    throw new Error("Unable to load charity selection.");
  }

  return data as null | {
    id: string;
    charity_id: string;
    contribution_bps: number;
    effective_from: string;
    charities: {
      id: string;
      slug: string;
      name: string;
      category: string | null;
      is_demo: boolean;
    } | null;
  };
}

export async function getMyContributions() {
  const supabase = await createUserClient();

  const { data, error } = await supabase
    .from("contributions")
    .select(
      "id, kind, amount_minor, charity_minor, pool_minor, platform_minor, charity_bps, invoice_id, recognized_at, charities(name)",
    )
    .order("recognized_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("Failed to fetch contributions:", error.message);
    throw new Error("Unable to load contributions.");
  }

  return (data ?? []) as unknown as {
    id: string;
    kind: string;
    amount_minor: number;
    charity_minor: number;
    pool_minor: number;
    platform_minor: number;
    charity_bps: number;
    invoice_id: string | null;
    recognized_at: string;
    charities: { name: string } | null;
  }[];
}

export async function getMyWinnings() {
  const supabase = await createUserClient();

  const { data, error } = await supabase
    .from("winnings")
    .select(
      "id, draw_id, tier, amount_minor, claim_status, rejection_reason, created_at, draws(title, period_month)",
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch winnings:", error.message);
    throw new Error("Unable to load winnings.");
  }

  return (data ?? []) as unknown as {
    id: string;
    draw_id: string;
    tier: number;
    amount_minor: number;
    claim_status: string;
    rejection_reason: string | null;
    created_at: string;
    draws: { title: string; period_month: string } | null;
  }[];
}

export async function getMyUnreadCount(): Promise<number> {
  const supabase = await createUserClient();

  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  if (error) {
    console.error("Failed to fetch unread count:", error.message);
    throw new Error("Unable to load notifications.");
  }

  return count ?? 0;
}

/**
 * Eligibility for the next draw.
 * Uses the same eligibility engine as the draw snapshot.
 */
export function myEligibility(
  userId: string,
  sub: SubscriptionRow | null,
  scores: ScoreRow[],
  now = new Date(),
) {
  const candidate: CandidateUser = {
    userId,
    subscription: sub
      ? {
          status: sub.status,
          activeFrom: sub.current_period_start ?? sub.created_at,
          activeUntil: sub.current_period_end,
        }
      : null,
    scores: scores.map((score) => ({
      id: score.id,
      scoreDate: score.score_date,
      value: score.value,
    })),
  };

  // Temporary diagnostic: remove after identifying the issue.
  console.log("Eligibility diagnostic:", {
    userId,
    subscriptionId: sub?.id ?? null,
    status: sub?.status ?? null,
    activeFrom: candidate.subscription?.activeFrom ?? null,
    activeUntil: candidate.subscription?.activeUntil ?? null,
    checkedAt: now.toISOString(),
    scoreCount: scores.length,
  });

  const result = evaluateEligibility(candidate, now);

  const messages: Record<string, string> = {
    no_subscription: "Start a subscription to enter the draw.",
    subscription_inactive:
      "Your subscription isn't active right now. Renew to take part.",
    too_few_scores: `You have ${scores.length} of 5 scores. Add ${Math.max(
      0,
      5 - scores.length,
    )} more to be eligible.`,
    invalid_scores:
      "One of your scores looks invalid. Please review them.",
  };

  return {
    eligible: result.eligible,
    message: result.eligible
      ? "You're eligible: active subscription and five scores recorded."
      : messages[result.reason ?? ""] ??
        "Eligibility could not be determined. Please try again.",
  };
}
