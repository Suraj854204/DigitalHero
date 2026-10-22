/**
 * Seeds CLEARLY-LABELLED DEMO subscribers so an evaluator can see populated screens.
 * Refuses to run in production or unless ALLOW_DEMO_SEED=true. Demo users use @demo.invalid addresses.
 * Charities are seeded by the SQL migration (placeholders, not real partnerships).
 */
import { createClient } from "@supabase/supabase-js";

if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") { console.error("Refusing to seed demo data in production."); process.exit(1); }
if (process.env.ALLOW_DEMO_SEED !== "true") { console.error("Set ALLOW_DEMO_SEED=true to confirm you want demo data."); process.exit(1); }
const need = (k: string) => { const v = process.env[k]; if (!v) { console.error(`Missing ${k}.`); process.exit(1); } return v; };
const db = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
const password = process.env.DEMO_PASSWORD ?? "";
if (password.length < 12) { console.error("Set DEMO_PASSWORD (12+ characters)."); process.exit(1); }

const { data: charities, error: cErr } = await db.from("charities").select("id").eq("status", "active").limit(6);
if (cErr || !charities?.length) { console.error("No active charities found. Apply the migrations first."); process.exit(1); }

const names = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Isha", "Vikram", "Anaya"];
for (const [i, name] of names.entries()) {
  const email = `demo.${name.toLowerCase()}@demo.invalid`;
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `${name} (demo)` } });
  if (error) { console.log(`skip ${email}: ${error.message}`); continue; }
  const uid = data.user.id;
  const charity = charities[i % charities.length].id;
  await db.from("profiles").update({ display_name: `${name} (demo)`, onboarding_completed_at: new Date().toISOString(), terms_accepted_at: new Date().toISOString(), terms_version: "demo" }).eq("id", uid);
  await db.from("charity_selections").insert({ user_id: uid, charity_id: charity, contribution_bps: 1000 + (i % 3) * 500 });
  // Scores through the real RPC so the same rules/triggers apply. Distinct dates, values 1-45.
  for (let k = 0; k < 5; k++) {
    const d = new Date(Date.now() - (k + 1) * 6 * 86_400_000).toISOString().slice(0, 10);
    const { error: sErr } = await db.rpc("_add_score", { p_user: uid, p_date: d, p_value: ((i * 7 + k * 11) % 45) + 1 });
    if (sErr) console.log(`score skip: ${sErr.message}`);
  }
  console.log(`seeded ${email}`);
}
console.log("Done. Demo subscribers have NO paid subscription: use Stripe test checkout to activate one, or activate in SQL for local review only.");
