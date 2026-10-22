import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "./lib/env.ts";
import { refreshSession } from "./lib/supabase/proxy-client.ts";

/**
 * Optimistic gate + session refresh. This is NOT the security boundary: every page, server action
 * and route handler re-verifies the session and role server-side (src/lib/session.ts), and
 * Postgres RLS is the final control.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const protectedArea = /^\/(app|admin|onboarding)(\/|$)/.test(pathname);

  if (!isSupabaseConfigured()) {
    if (protectedArea) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("setup", "1");
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  const { user, response } = await refreshSession(request);
  if (protectedArea && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/stripe/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
