import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { safeNext } from "@/lib/redirect";
import { createUserClient } from "@/lib/supabase/server";

/** Email confirmation and password-recovery links land here with a one-time ?code=. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"), "/app");
  if (!isSupabaseConfigured()) return NextResponse.redirect(`${origin}/login?setup=1`);
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createUserClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/login?error=link`);
}
