import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isServiceRoleConfigured, isSupabaseConfigured, serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function authorised(header: string | null): boolean {
  const secret = serverEnv.cronSecret();
  if (!secret || secret.includes("REPLACE") || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Daily: recognise due annual-plan instalments (idempotent). Vercel Cron sends the secret as a Bearer token. */
export async function GET(req: Request) {
  if (!authorised(req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSupabaseConfigured() || !isServiceRoleConfigured()) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const { data, error } = await createAdminClient().rpc("recognize_due_installments");
  if (error) return NextResponse.json({ error: "failed" }, { status: 500 });
  return NextResponse.json({ recognised: data });
}
