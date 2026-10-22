# Architecture

```
Browser ── Next.js (RSC + server actions) ──┬─ Supabase (user JWT, RLS)       ← member data
                                            ├─ Supabase (service role, server) ← admin, webhooks, cron
                                            ├─ Stripe (Checkout, Portal, Webhooks)
                                            └─ AI provider (optional, server only)
```

**Layers**
- `src/lib/draw-engine/`: pure, dependency-free TypeScript: RNG, number drawing, eligibility, matching, prize allocation, ledger validation, contribution split, state machines. Fully unit tested.
- `supabase/migrations/`: authoritative business logic as `SECURITY DEFINER` functions (add_score, select_charity, post_*_payment, publish_draw, review_evidence, queue/mark payout). The TS engine and SQL are cross-checked (hash parity, split parity).
- `src/lib/stripe/`: `events.ts` is a framework-free webhook handler written against a `WebhookStore` port; `store.ts` is the Supabase implementation.
- `src/app/actions/*`: server actions; every mutation re-checks the actor (`requireActor`/`requireAdminAction`).
- `src/proxy.ts`: optimistic redirect for `/app`, `/admin`, `/onboarding` (not a security boundary; pages and actions re-check).
- `src/lib/ai/`: provider interface + grounding; every AI path has a deterministic fallback.

**Draw flow:** admin creates draw → simulate (writes `draw_simulations` only) → approve (freeze snapshot + hash) → publish (type PUBLISH; SQL re-verifies figures, writes matches, allocations, winnings, ledger entries, notifications, atomically and idempotently).

**Webhook flow:** verify raw-body signature → `claim_webhook_event` (idempotent; re-claims failed/stale) → apply state or post payment (invoice-level idempotency, out-of-order guard) → `finish_webhook_event`. Failure returns 500 so Stripe retries.
