# Requirements traceability

Status key: **Done** = implemented and covered by tests/build · **Done (unverified live)** = implemented, depends on an external service that wasn't reachable here · **Partial** · **Not implemented**.

| PRD area | Implementation | Tests | Status |
|---|---|---|---|
| Sign-up / login / reset | `src/app/(auth)/*`, `src/app/actions/auth.ts`, Supabase Auth, `auth/callback` | smoke only (needs live Auth) | Done (unverified live) |
| Roles: public / subscriber / admin | `profiles.role` + guard trigger, `src/lib/session.ts`, `src/proxy.ts` | `db-scores-rls`, `security-billing` | Done |
| Monthly & yearly subscription | `onboarding`, `actions/billing.ts`, Stripe Checkout, `plans` table | `security-billing`, `db-webhooks` | Done (unverified live) |
| Webhook-driven activation | `api/stripe/webhook`, `lib/stripe/events.ts`, SQL `claim_webhook_event` etc. | `security-billing` (21), `db-webhooks` (3) | Done (unverified live) |
| Score entry: 1-45, date, **latest 5 retained** | SQL `_add_score` + cap trigger, `lib/scores/rolling.ts` | `scores` (14), `db-scores-rls` (16) | Done |
| Edit / delete scores | `actions/scores.ts` → RPCs | same | Done |
| Scores shown most-recent first | `app/scores`, ordered by date desc | scores tests | Done |
| Charity listing, search, filter, profile | `/charities`, `/charities/[slug]` | build + smoke | Done |
| Charity selection, min 10 %, adjustable | `select_charity` SQL, `app/charity`, onboarding | `db-scores-rls`, `security-billing` | Done |
| Contribution calculation | `splitPayment` (TS) + `split_payment_sql` (SQL), both tested to agree | `security-billing`, `db-draws` | Done |
| Independent donation | `post_donation` SQL groundwork only; **no UI** | none | **Not implemented** (PRD marks it optional) |
| Draw: random & weighted modes | `draw-engine/numbers.ts` | `engine-numbers` | Done |
| Simulation before publish | `simulateDraw`, `record_simulation`, admin draw page | `engine-run`, `db-draws` | Done |
| 5/4/3-match tiers, equal split, 40/35/25 default | `matching.ts`, `prizes.ts` | `engine-matching`, `engine-prizes` | Done |
| Jackpot rollover | `prizes.ts`, `jackpot_ledger`, `public_jackpot_balance` | `engine-prizes`, `db-draws` | Done |
| Publish results | `publish_draw` SQL (atomic, idempotent) | `db-draws` (26) | Done |
| Winner verification (screenshot) | `actions/evidence.ts`, private bucket, admin review | `security-billing`, `db-draws`, `helpers-misc` | Done (storage unverified live) |
| Payout tracking Pending → Paid | `queue_payout`, `mark_payout_paid`, admin payouts | `db-draws` | Done (no money movement by design) |
| Subscriber dashboard modules | `/app/*` (status, scores, charity, draws, winnings, billing, notifications) | build + smoke | Done |
| Admin: users, subscriptions, scores | `/admin/users`, `/admin/subscriptions` (score edit via user detail RPC) | `db-scores-rls` | Done |
| Admin: draws, charities, winners | `/admin/draws`, `/admin/charities`, `/admin/winners` | `db-draws` | Done |
| Admin: reports/analytics | `/admin/reports` + CSV export, overview charts | typecheck/build | Done (UI not browser-tested with data) |
| Responsive, accessible UI | Tailwind, focus styles, reduced-motion | Playwright overflow check on 9 public pages × 2 viewports | Done (public pages only) |
| Error handling | `error.tsx`, `loading.tsx`, `friendlyDbError`, form states | partial | Done |
| New Vercel + Supabase deployment | `docs/DEPLOYMENT.md`, `vercel.json` | not performed | **Not performed** |
