# Deployment (new Vercel + new Supabase, per PRD)

1. **Supabase:** new project → run migrations 001-005 → copy URL, anon key, service-role key. Auth → URL configuration: Site URL = production URL; add `<url>/auth/callback` redirect.
2. **Stripe (test mode):** create two recurring Prices (monthly, yearly) matching the prices in Admin → Settings. Add a webhook endpoint `<url>/api/stripe/webhook` for `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`. Copy the signing secret.
3. **Vercel:** new project from this repo. Set every variable in `.env.example` (production values; `ALLOW_DEMO_SEED=false`). `vercel.json` registers the daily cron for `/api/cron/recognize`; Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.
4. Run `provision-admin` once against the production project from a trusted machine.
5. Smoke test: sign up → checkout with Stripe test card 4242… → webhook activates → add scores → admin creates/simulates/approves/publishes a draw.

**Not performed in the build environment:** none of the above was executed here.
