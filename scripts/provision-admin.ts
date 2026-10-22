/**
 * Creates (or promotes) the first administrator. There is deliberately NO public admin signup.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='long-random-pass' \
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run provision-admin
 *
 * Credentials come from the environment only; nothing is stored in the repo.
 */
import { createClient } from "@supabase/supabase-js";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) { console.error(`Missing ${k}. See docs/SETUP.md.`); process.exit(1); }
  return v;
};

const url = need("NEXT_PUBLIC_SUPABASE_URL");
const key = need("SUPABASE_SERVICE_ROLE_KEY");
const email = need("ADMIN_EMAIL").toLowerCase();
const password = need("ADMIN_PASSWORD");
if (password.length < 12) { console.error("ADMIN_PASSWORD must be at least 12 characters."); process.exit(1); }

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function findUserId(): Promise<string | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

let id = await findUserId();
if (!id) {
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: "Administrator" } });
  if (error) throw error;
  id = data.user.id;
  console.log("Created auth user.");
} else {
  console.log("Auth user already exists; leaving its password unchanged.");
}
const { data: promoted, error } = await db.rpc("promote_to_admin", { p_email: email });
if (error) throw error;
if (!promoted) { console.error("Could not promote: no profile row for that email."); process.exit(1); }
console.log(`${email} is now an administrator. Sign in at /login, then open /admin.`);
