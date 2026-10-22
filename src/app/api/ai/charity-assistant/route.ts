import { NextResponse } from "next/server";
import { recommendCharities } from "@/lib/ai/charity-assistant";
import { assistantInputSchema } from "@/lib/ai/grounding";
import { getCharities } from "@/lib/data/public";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const rl = rateLimit(`ai:${ip}`, 8, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests. Please wait a moment." }, { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } });

  const body = await req.json().catch(() => null);
  const parsed = assistantInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

  const { items } = await getCharities({ pageSize: 48 });
  const result = await recommendCharities(parsed.data.query, items.map((c) => ({ slug: c.slug, name: c.name, category: c.category, location: c.location, summary: c.short_description })));
  return NextResponse.json(result);
}
