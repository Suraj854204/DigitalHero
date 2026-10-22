/** Pure, provider-independent grounding and validation logic (unit tested without any network). */
import { z } from "zod";

export interface CharityFact {
  slug: string;
  name: string;
  category: string | null;
  location: string | null;
  summary: string | null;
}

export const assistantInputSchema = z.object({ query: z.string().trim().min(3, "Tell us a little more.").max(300) });

const STOP = new Set("the a an and or of to in for with on at by from i me my we you your is are be want like care about support help that this it as".split(" "));
const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t));

const SYNONYMS: Record<string, string[]> = {
  kids: ["youth", "education", "children", "school"], children: ["youth", "education"], school: ["education"], learning: ["education"],
  water: ["health"], medical: ["health"], hospital: ["health"], clinic: ["health"],
  nature: ["environment"], climate: ["environment"], river: ["environment"], trees: ["environment"],
  food: ["community"], hunger: ["community"], meals: ["community"],
  dogs: ["animal"], cats: ["animal"], animals: ["animal"], pets: ["animal"], strays: ["animal"],
  sport: ["youth"], teens: ["youth"],
};

export interface Ranked { charity: CharityFact; score: number }

/** Deterministic keyword retrieval: the ONLY source of candidates, so AI can never invent a charity. */
export function rankCharities(query: string, charities: CharityFact[], limit = 3): Ranked[] {
  const qt = tokens(query).flatMap((t) => [t, ...(SYNONYMS[t] ?? [])]);
  const ranked = charities.map((c) => {
    const hay = tokens(`${c.name} ${c.category ?? ""} ${c.location ?? ""} ${c.summary ?? ""}`);
    const set = new Set(hay);
    let score = 0;
    for (const t of qt) {
      if (set.has(t)) score += 2;
      else if (hay.some((h) => h.startsWith(t) || t.startsWith(h))) score += 1;
    }
    if (c.category && qt.includes(c.category.toLowerCase().split(" ")[0])) score += 3;
    return { charity: c, score };
  });
  return ranked.filter((r) => r.score > 0).sort((a, b) => b.score - a.score || a.charity.name.localeCompare(b.charity.name)).slice(0, limit);
}

export const aiPicksSchema = z.object({
  picks: z.array(z.object({ slug: z.string().max(80), reason: z.string().trim().min(5).max(240) })).max(3),
});

/** Parses model output defensively. Anything outside the grounded candidate set is dropped. */
export function parseAiPicks(raw: string, allowedSlugs: Set<string>): { slug: string; reason: string }[] | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = aiPicksSchema.safeParse(JSON.parse(raw.slice(start, end + 1)));
    if (!parsed.success) return null;
    const seen = new Set<string>();
    const picks = parsed.data.picks.filter((p) => allowedSlugs.has(p.slug) && !seen.has(p.slug) && seen.add(p.slug));
    // Reasons must not make money/impact claims we cannot support.
    const claimy = /(\d[\d,.]*\s?(%|people|lives|children|families|meals|₹|rs\b|rupees|dollars))|guarantee|certified|accredited|tax[- ]deductible/i;
    return picks.length > 0 && picks.every((p) => !claimy.test(p.reason)) ? picks : null;
  } catch {
    return null;
  }
}

/** Every number in AI-written text must already exist in the facts we supplied. */
export function numbersAreGrounded(output: string, facts: string): boolean {
  const norm = (s: string) => s.replace(/,/g, "");
  const known = new Set((norm(facts).match(/\d+(\.\d+)?/g) ?? []));
  return (norm(output).match(/\d+(\.\d+)?/g) ?? []).every((n) => known.has(n));
}

export function fallbackReason(c: CharityFact): string {
  const bits = [c.category && `works in ${c.category.toLowerCase()}`, c.location && `based in ${c.location}`].filter(Boolean).join(" and ");
  return `${c.name} ${bits || "matches your search"}.`;
}
