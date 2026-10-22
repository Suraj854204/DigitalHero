# Implementation status

**Completed and verified locally:** draw engine; score rules; SQL schema, RLS, functions; ledger and reconciliation; webhook logic; admin console (users, subscriptions, charities, draws workflow, winners, payouts, contributions, reports + CSV, audit logs, settings); public site; subscriber app; AI grounding/fallbacks.

**Implemented but not live-verified:** Supabase Auth flows and storage; Stripe checkout/portal/webhook; AI provider call; cron; email delivery (none: in-app notifications only).

**Partial:** admin per-user score editing is via the user detail page only; legal pages are templates; reports UI not exercised with real data in a browser.

**Not implemented:** independent donations UI; post-publish result correction; email notifications; admin MFA; CSP header; shared-store rate limiting; authenticated browser E2E tests; Vercel/Supabase deployment.
