import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "../env.ts";

/**
 * SERVICE-ROLE client. Bypasses Row Level Security. `server-only` makes any import from a client
 * component a build error. Every caller MUST authorise the actor first (requireAdmin /
 * requireActor) - see src/lib/session.ts. Admin SQL functions also re-check the actor's role.
 */
export function createAdminClient() {
  const key = serverEnv.serviceRoleKey();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(publicEnv.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
