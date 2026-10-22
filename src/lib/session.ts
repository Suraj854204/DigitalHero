import "server-only";
import { redirect, notFound } from "next/navigation";
import { AuthorizationError, requireAdmin, type Actor } from "./authz.ts";
import { isSupabaseConfigured } from "./env.ts";
import { createUserClient } from "./supabase/server.ts";

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  role: "subscriber" | "admin";
  status: "active" | "suspended";
  onboarding_completed_at: string | null;
  terms_accepted_at: string | null;
}

export interface Session {
  actor: Actor;
  profile: Profile;
}

/** Verified session from Supabase Auth (JWT validated remotely) plus the profile row. */
export async function getSession(): Promise<Session | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createUserClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
  if (!profile) return null;
  return {
    actor: { id: profile.id, role: profile.role, suspended: profile.status === "suspended" },
    profile: profile as Profile,
  };
}

/** For pages in /app: redirects anonymous users to login and blocks suspended accounts. */
export async function requireUserPage(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.actor.suspended) redirect("/login?suspended=1");
  return s;
}

/** For pages in /admin: non-admins get a 404 so the console's existence is not advertised. */
export async function requireAdminPage(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login?next=/admin");
  try {
    requireAdmin(s.actor);
  } catch (e) {
    if (e instanceof AuthorizationError) notFound();
    throw e;
  }
  return s;
}

/** For server actions and route handlers: throws AuthorizationError instead of redirecting. */
export async function requireAdminAction(): Promise<Session> {
  const s = await getSession();
  requireAdmin(s?.actor);
  return s!;
}
