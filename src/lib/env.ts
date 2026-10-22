/**
 * Central, typed access to environment configuration.
 * Server-only secrets are read lazily inside functions so importing this file from a client
 * component can never bundle a secret (the secret getters throw in the browser).
 */
export const publicEnv = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
};

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey && !publicEnv.supabaseUrl.includes("YOUR-PROJECT"));
}

function secret(name: string): string {
  if (typeof window !== "undefined") throw new Error(`${name} is server-only`);
  return process.env[name] ?? "";
}

export const serverEnv = {
  serviceRoleKey: () => secret("SUPABASE_SERVICE_ROLE_KEY"),
  stripeSecretKey: () => secret("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: () => secret("STRIPE_WEBHOOK_SECRET"),
  stripePriceMonthly: () => secret("STRIPE_PRICE_MONTHLY"),
  stripePriceYearly: () => secret("STRIPE_PRICE_YEARLY"),
  cronSecret: () => secret("CRON_SECRET"),
  aiProvider: () => (secret("AI_PROVIDER") || "none").toLowerCase(),
  aiKey: () => secret("ANTHROPIC_API_KEY"),
  aiModel: () => secret("AI_MODEL") || "claude-sonnet-4-5",
  aiTimeoutMs: () => Number.parseInt(secret("AI_TIMEOUT_MS") || "8000", 10),
};

export function isStripeConfigured(): boolean {
  const k = serverEnv.stripeSecretKey();
  return k.startsWith("sk_") && !k.includes("REPLACE");
}
export function isServiceRoleConfigured(): boolean {
  return serverEnv.serviceRoleKey().length > 20 && !serverEnv.serviceRoleKey().includes("YOUR_");
}
