# Database

Five migrations in `supabase/migrations/`, applied in order (`supabase db push` or paste into the SQL editor). All apply cleanly on Postgres (verified with PGlite). Every `public` table has RLS enabled.

| Migration | Contents |
|---|---|
| 001 core | profiles (role-guard trigger), app_settings, plans, charities, charity_events, charity_selections, subscriptions (+history), scores (cap trigger) |
| 002 draws & finance | draws (immutability/transition triggers), simulations, participants/snapshots, matches, prize_allocations, draw & jackpot ledgers, winnings, winner_evidence, payouts, contributions, recognition_schedule, financial_ledger (deferred balance trigger), notifications, audit_logs (append-only), webhook_events |
| 003 functions | business logic functions, snapshot hashing, views `v_ledger_balances`, `v_reconciliation` |
| 004 RLS & grants | revoke-all then selective grants and policies; column-level grants on profiles |
| 005 contact & storage | contact_messages (service-role only), private `winner-evidence` bucket + policies |

**Ledger accounts:** cash, deferred_revenue, charity_payable, prize_pool, platform_revenue, prize_payable, jackpot_carry, reserve_unclaimed. Each posting group must balance (deferred constraint trigger).

**Reconciliation** (`v_reconciliation`): prize pool vs unspent pool contributions; jackpot vs jackpot ledger; deferred revenue vs unrecognised instalments; charity payable vs contributions; prize payable vs unpaid winnings; reserve vs draw reserves. Shown in Admin → Reports and Payouts.
