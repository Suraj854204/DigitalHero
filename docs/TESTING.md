# Testing

Command: `npm test` → `node --test --experimental-test-isolation=none tests/*.test.ts`.
Last run: **158 tests, 158 pass, 0 fail, 0 skipped.**

| File | Count focus |
|---|---|
| engine-numbers/matching/prizes/run | 64: RNG, weighting, matching, prize math, ledger validation, run/publish |
| scores | 14: rolling-5 rules |
| security-billing | 21: authz, webhook logic, contribution split, annual schedule |
| ai, helpers-misc | 13: grounding, fallbacks, provider errors, safeNext, CSV, image sniffing, rate limit, money format |
| db-* | 46: migrations on PGlite, RLS, draws/ledger/payout flow, webhook idempotency |

Also run: `tsc --noEmit` (clean), `eslint` (0 errors, 6 warnings), `next build` (success), production server smoke test (public routes 200, protected routes redirect, bad webhook 400, cron without secret 401), Playwright: no horizontal overflow on 9 public pages at 375 px and 1280 px.

**Not covered:** live Supabase/Stripe/AI; real concurrent transactions (PGlite is single-connection; safety relies on row locks and unique constraints); browser E2E of authenticated flows; accessibility audit with tooling.
