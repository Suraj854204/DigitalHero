import "server-only";
import { isSupabaseConfigured } from "../env.ts";
import { createUserClient } from "../supabase/server.ts";
import { DEFAULT_PUBLIC_SETTINGS, DEMO_CHARITIES, DEMO_PLANS, type CharityRow } from "./demo.ts";

export type { CharityRow };

export interface CharityQuery {
  q?: string;
  category?: string;
  location?: string;
  page?: number;
  pageSize?: number;
}

export interface CharityPage {
  items: CharityRow[];
  total: number;
  page: number;
  pageSize: number;
  categories: string[];
  locations: string[];
  isDemoSource: boolean;
}

const esc = (s: string) => s.replace(/[%_,()]/g, " ").trim();

export async function getCharities(query: CharityQuery = {}): Promise<CharityPage> {
  const pageSize = Math.min(Math.max(query.pageSize ?? 9, 1), 48);
  const page = Math.max(query.page ?? 1, 1);
  const q = query.q?.trim().toLowerCase() ?? "";

  if (!isSupabaseConfigured()) {
    let items = DEMO_CHARITIES.filter((c) => c.status === "active");
    const categories = [...new Set(items.map((c) => c.category!).filter(Boolean))].sort();
    const locations = [...new Set(items.map((c) => c.location!).filter(Boolean))].sort();
    if (q) items = items.filter((c) => `${c.name} ${c.short_description} ${c.category}`.toLowerCase().includes(q));
    if (query.category) items = items.filter((c) => c.category === query.category);
    if (query.location) items = items.filter((c) => c.location === query.location);
    return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize, categories, locations, isDemoSource: true };
  }

  const supabase = await createUserClient();
  let req = supabase.from("charities").select("*", { count: "exact" }).eq("status", "active");
  if (q) req = req.or(`name.ilike.%${esc(q)}%,short_description.ilike.%${esc(q)}%,category.ilike.%${esc(q)}%`);
  if (query.category) req = req.eq("category", query.category);
  if (query.location) req = req.eq("location", query.location);
  const { data, count } = await req
    .order("is_featured", { ascending: false })
    .order("name")
    .range((page - 1) * pageSize, page * pageSize - 1);
  const { data: facets } = await supabase.from("charities").select("category, location").eq("status", "active");
  const categories = [...new Set((facets ?? []).map((f) => f.category).filter(Boolean) as string[])].sort();
  const locations = [...new Set((facets ?? []).map((f) => f.location).filter(Boolean) as string[])].sort();
  return { items: (data ?? []) as CharityRow[], total: count ?? 0, page, pageSize, categories, locations, isDemoSource: false };
}

export async function getCharityBySlug(slug: string): Promise<CharityRow | null> {
  if (!isSupabaseConfigured()) return DEMO_CHARITIES.find((c) => c.slug === slug) ?? null;
  const supabase = await createUserClient();
  const { data } = await supabase.from("charities").select("*").eq("slug", slug).eq("status", "active").maybeSingle();
  return (data as CharityRow) ?? null;
}

export async function getFeaturedCharity(): Promise<CharityRow | null> {
  if (!isSupabaseConfigured()) return DEMO_CHARITIES.find((c) => c.is_featured) ?? null;
  const supabase = await createUserClient();
  const { data } = await supabase.from("charities").select("*").eq("status", "active").eq("is_featured", true).limit(1).maybeSingle();
  return (data as CharityRow) ?? null;
}

export async function getCharityEvents(charityId: string) {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createUserClient();
  const { data } = await supabase
    .from("charity_events")
    .select("id, title, description, location, starts_at")
    .eq("charity_id", charityId)
    .eq("status", "published")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(5);
  return data ?? [];
}

export async function getPlans() {
  if (!isSupabaseConfigured()) return [...DEMO_PLANS];
  const supabase = await createUserClient();
  const { data } = await supabase.from("plans").select("id, name, interval, amount_minor").eq("is_active", true).order("amount_minor");
  return (data?.length ? data : [...DEMO_PLANS]) as { id: string; name: string; interval: string; amount_minor: number }[];
}

export async function getPublicSettings() {
  if (!isSupabaseConfigured()) return DEFAULT_PUBLIC_SETTINGS;
  const supabase = await createUserClient();
  const { data } = await supabase.from("app_settings").select("key, value").in("key", ["prize_pool_bps", "min_charity_bps", "tier_config"]);
  const m = new Map((data ?? []).map((r) => [r.key as string, r.value]));
  return {
    prizePoolBps: Number(m.get("prize_pool_bps") ?? DEFAULT_PUBLIC_SETTINGS.prizePoolBps),
    minCharityBps: Number(m.get("min_charity_bps") ?? DEFAULT_PUBLIC_SETTINGS.minCharityBps),
    prizePoolConfirmed: false,
    tierConfig: (m.get("tier_config") as typeof DEFAULT_PUBLIC_SETTINGS.tierConfig) ?? DEFAULT_PUBLIC_SETTINGS.tierConfig,
  };
}

export interface PublishedDraw {
  id: string;
  title: string;
  period_month: string;
  winning_numbers: number[];
  published_at: string;
  participant_count: number | null;
  pool_minor: number | null;
  jackpot_carry_in_minor: number | null;
}

export async function getPublishedDraws(limit = 12): Promise<PublishedDraw[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createUserClient();
  const { data } = await supabase
    .from("draws")
    .select("id, title, period_month, winning_numbers, published_at, participant_count, pool_minor, jackpot_carry_in_minor")
    .eq("status", "published")
    .order("period_month", { ascending: false })
    .limit(limit);
  return (data ?? []) as PublishedDraw[];
}

export async function getJackpotBalance(): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const supabase = await createUserClient();
  const { data } = await supabase.rpc("public_jackpot_balance");
  return Number(data ?? 0);
}
