import { getAiProvider, type AiProvider } from "./provider.ts";
import { fallbackReason, parseAiPicks, rankCharities, type CharityFact } from "./grounding.ts";

export interface AssistantResult {
  source: "ai" | "fallback";
  picks: { slug: string; name: string; reason: string }[];
  note?: string;
}

const SYSTEM = [
  "You help a member choose a charity on Digital Heroes.",
  "Use ONLY the candidate charities provided in the user message. Never invent a charity, statistic, outcome, partnership or accreditation.",
  "Never mention prices, prizes, tax benefits or guarantees.",
  'Reply with JSON only: {"picks":[{"slug":"<one of the candidate slugs>","reason":"<one friendly sentence under 200 characters>"}]}',
].join(" ");

export async function recommendCharities(query: string, all: CharityFact[], provider: AiProvider | null = getAiProvider()): Promise<AssistantResult> {
  const candidates = rankCharities(query, all, 5);
  const byslug = new Map(candidates.map((r) => [r.charity.slug, r.charity]));
  const deterministic = () => candidates.slice(0, 3).map((r) => ({ slug: r.charity.slug, name: r.charity.name, reason: fallbackReason(r.charity) }));

  if (candidates.length === 0) return { source: "fallback", picks: [], note: "No close match yet. Try a cause, such as education, health, environment or animals." };
  if (!provider) return { source: "fallback", picks: deterministic() };

  try {
    const user = `Member says: "${query}"\n\nCandidates:\n` + candidates.map((r) => `- slug=${r.charity.slug}; name=${r.charity.name}; category=${r.charity.category ?? "n/a"}; location=${r.charity.location ?? "n/a"}; about=${r.charity.summary ?? "n/a"}`).join("\n");
    const raw = await provider.complete({ system: SYSTEM, user, maxTokens: 400 });
    const picks = parseAiPicks(raw, new Set(byslug.keys()));
    if (!picks) return { source: "fallback", picks: deterministic() };
    return { source: "ai", picks: picks.map((p) => ({ slug: p.slug, name: byslug.get(p.slug)!.name, reason: p.reason })) };
  } catch {
    return { source: "fallback", picks: deterministic() }; // provider down/timeout: product keeps working
  }
}
