import assert from "node:assert/strict";
import { test } from "node:test";
import { fallbackReason, numbersAreGrounded, parseAiPicks, rankCharities, type CharityFact } from "../src/lib/ai/grounding.ts";
import { recommendCharities } from "../src/lib/ai/charity-assistant.ts";
import { createAnthropicProvider, type AiProvider } from "../src/lib/ai/provider.ts";
import { deterministicSummary, summarizeReport, type ReportFacts } from "../src/lib/ai/report-summary.ts";

const charities: CharityFact[] = [
  { slug: "green-roots", name: "Green Roots", category: "Environment", location: "Pune", summary: "Tree planting and watershed restoration." },
  { slug: "bright-minds", name: "Bright Minds", category: "Education", location: "Delhi", summary: "After-school learning support for children." },
  { slug: "paws-care", name: "Paws Care", category: "Animals", location: "Mumbai", summary: "Shelter and veterinary care for stray animals." },
];
const facts: ReportFacts = { periodLabel: "Last 180 days", activeSubscriptions: 12, newSubscriptions: 3, revenueMinor: 1198800, charityMinor: 119880, poolMinor: 599400, pendingReviews: 2, pendingPayouts: 1 };
const stub = (reply: string | Error): AiProvider => ({ name: "stub", complete: async () => { if (reply instanceof Error) throw reply; return reply; } });

test("ranking only returns supplied charities and favours matching terms", () => {
  const r = rankCharities("I care about education for kids", charities, 3);
  assert.equal(r[0].charity.slug, "bright-minds");
  assert.ok(r.every((x) => charities.some((c) => c.slug === x.charity.slug)));
});

test("parseAiPicks drops unknown slugs, duplicates and unsupported claims", () => {
  const allowed = new Set(charities.map((c) => c.slug));
  const ok = parseAiPicks('Here: {"picks":[{"slug":"green-roots","reason":"Works on environment in Pune."}]}', allowed);
  assert.deepEqual(ok, [{ slug: "green-roots", reason: "Works on environment in Pune." }]);
  assert.equal(parseAiPicks('{"picks":[{"slug":"made-up","reason":"Sounds great for you."}]}', allowed), null);
  assert.equal(parseAiPicks('{"picks":[{"slug":"green-roots","reason":"Has helped 5,000 people."}]}', allowed), null);
  assert.equal(parseAiPicks('{"picks":[{"slug":"green-roots","reason":"Fully accredited charity."}]}', allowed), null);
  assert.equal(parseAiPicks("not json at all", allowed), null);
  const dup = parseAiPicks('{"picks":[{"slug":"paws-care","reason":"Cares for strays."},{"slug":"paws-care","reason":"Cares for strays."}]}', allowed);
  assert.equal(dup?.length, 1);
});

test("numbersAreGrounded rejects invented figures", () => {
  assert.equal(numbersAreGrounded("12 active, 3 new.", "Active: 12\nNew: 3"), true);
  assert.equal(numbersAreGrounded("Revenue grew 40%.", "Active: 12\nNew: 3"), false);
  assert.equal(numbersAreGrounded("₹1,198,800 total", "Revenue ₹1198800"), true);
});

test("assistant without a provider falls back deterministically", async () => {
  const r = await recommendCharities("animals shelter", charities, null);
  assert.equal(r.source, "fallback");
  assert.equal(r.picks[0].slug, "paws-care");
  assert.equal(r.picks[0].reason, fallbackReason(charities[2]));
});

test("assistant uses grounded AI picks, and falls back on bad output or errors", async () => {
  const good = await recommendCharities("trees and environment", charities, stub('{"picks":[{"slug":"green-roots","reason":"Plants trees near Pune."}]}'));
  assert.equal(good.source, "ai");
  assert.equal(good.picks[0].name, "Green Roots");
  assert.equal((await recommendCharities("trees and environment", charities, stub('{"picks":[{"slug":"ghost","reason":"Totally made up."}]}'))).source, "fallback");
  assert.equal((await recommendCharities("trees and environment", charities, stub(new Error("boom")))).source, "fallback");
});

test("assistant returns an honest empty result when nothing matches", async () => {
  const r = await recommendCharities("zzzqqq xxyyzz", charities, null);
  assert.equal(r.picks.length, 0);
  assert.ok(r.note);
});

test("report summary: grounded AI text accepted, invented numbers discarded, provider failure falls back", async () => {
  assert.equal((await summarizeReport(facts, stub("12 active subscriptions and 3 new."))).source, "ai");
  assert.equal((await summarizeReport(facts, stub("Revenue will reach 99 lakh next year."))).source, "fallback");
  const down = await summarizeReport(facts, stub(new Error("down")));
  assert.equal(down.text, deterministicSummary(facts));
  assert.equal((await summarizeReport(facts, null)).source, "fallback");
});

test("anthropic provider: maps HTTP errors, empty output and timeouts to AiError", async () => {
  const make = (fetchImpl: typeof fetch, timeoutMs = 1000) => createAnthropicProvider({ apiKey: "k", model: "m", timeoutMs, fetchImpl });
  const ok = make((async () => new Response(JSON.stringify({ content: [{ type: "text", text: "hi" }] }), { status: 200 })) as typeof fetch);
  assert.equal(await ok.complete({ system: "s", user: "u" }), "hi");
  await assert.rejects(make((async () => new Response("no", { status: 500 })) as typeof fetch).complete({ system: "s", user: "u" }), /responded 500/);
  await assert.rejects(make((async () => new Response(JSON.stringify({ content: [] }), { status: 200 })) as typeof fetch).complete({ system: "s", user: "u" }), /empty/);
  const hang = ((_u: unknown, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" }))))) as typeof fetch;
  await assert.rejects(make(hang, 20).complete({ system: "s", user: "u" }), /timed out/);
});
