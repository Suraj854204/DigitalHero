import { getAiProvider, type AiProvider } from "./provider.ts";
import { numbersAreGrounded } from "./grounding.ts";

export interface ReportFacts {
  periodLabel: string;
  activeSubscriptions: number;
  newSubscriptions: number;
  revenueMinor: number;
  charityMinor: number;
  poolMinor: number;
  pendingReviews: number;
  pendingPayouts: number;
}

const money = (m: number) => `₹${(m / 100).toLocaleString("en-IN")}`;

export function factsText(f: ReportFacts): string {
  return [
    `Period: ${f.periodLabel}`,
    `Active subscriptions: ${f.activeSubscriptions}`,
    `New subscriptions: ${f.newSubscriptions}`,
    `Subscription revenue: ${money(f.revenueMinor)}`,
    `Charity allocation: ${money(f.charityMinor)}`,
    `Prize pool contribution: ${money(f.poolMinor)}`,
    `Evidence awaiting review: ${f.pendingReviews}`,
    `Payouts awaiting transfer: ${f.pendingPayouts}`,
  ].join("\n");
}

export function deterministicSummary(f: ReportFacts): string {
  const lines = [
    `${f.periodLabel}: ${f.activeSubscriptions} active subscriptions, ${f.newSubscriptions} new.`,
    `Revenue ${money(f.revenueMinor)}, of which ${money(f.charityMinor)} is allocated to charities and ${money(f.poolMinor)} to the prize pool.`,
  ];
  if (f.pendingReviews + f.pendingPayouts > 0) lines.push(`Needs attention: ${f.pendingReviews} evidence submissions to review and ${f.pendingPayouts} payouts to transfer.`);
  else lines.push("Nothing is waiting for review or payout.");
  return lines.join(" ");
}

/** Admin-only convenience. Numbers in AI output are verified against the supplied facts or the text is discarded. */
export async function summarizeReport(f: ReportFacts, provider: AiProvider | null = getAiProvider()): Promise<{ source: "ai" | "fallback"; text: string }> {
  const fallback = { source: "fallback" as const, text: deterministicSummary(f) };
  if (!provider) return fallback;
  try {
    const facts = factsText(f);
    const text = await provider.complete({
      system: "Summarise the operating facts for an administrator in at most three short sentences. Use only the facts given. Do not predict, recommend financial decisions, or add any number that is not in the facts.",
      user: facts,
      maxTokens: 200,
    });
    return numbersAreGrounded(text, facts) ? { source: "ai", text: text.trim() } : fallback;
  } catch {
    return fallback;
  }
}
