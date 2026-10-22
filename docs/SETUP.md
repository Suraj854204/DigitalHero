# Local setup

Requires Node ≥ 22.18.
1. `npm install`
2. Create a **new** Supabase project. Run the five migrations in order (SQL editor or `supabase db push`).
3. `cp .env.example .env.local` and fill: Supabase URL/anon/service-role keys, Stripe **test** keys and two Price IDs (monthly, yearly), `CRON_SECRET`.
4. In Supabase Auth settings set Site URL to `http://localhost:3000` and add `http://localhost:3000/auth/callback` as a redirect URL.
5. Create the admin: `ADMIN_EMAIL=… ADMIN_PASSWORD='…12+ chars' npm run provision-admin` (env vars from `.env.local` must be exported in the shell, e.g. `node --env-file=.env.local scripts/provision-admin.ts`).
6. Optional demo members: `ALLOW_DEMO_SEED=true DEMO_PASSWORD='…' node --env-file=.env.local scripts/seed.ts`.
7. `npm run dev`. For webhooks see STRIPE.md.

Never commit `.env.local`. The service-role key and Stripe secret must stay server-side.
