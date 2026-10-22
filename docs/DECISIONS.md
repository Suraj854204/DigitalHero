# Decisions and assumptions

The PRD leaves several rules open. Each default below is configurable or isolated so it can change without a rewrite. **Items marked ⚠ need client confirmation.**

1. ⚠ **Prize pool share.** The PRD doesn't give a percentage. Default 50 % of each recognised payment (`app_settings.prize_pool_bps = 5000`). `prize_pool_confirmed` stays `false` until an admin ticks the box in Settings; the admin UI shows a warning until then.
2. **Charity share.** Member-chosen, minimum 10 % (PRD 08.1), enforced by a DB constraint. Platform revenue = payment − charity − pool.
3. **Currency.** INR; ₹999/month and ₹9,990/year are *placeholder* prices (editable in Settings; the Stripe Price IDs are configured separately).
4. **Money.** Integer paise; basis points for percentages; BigInt for percent math. Rounding remainders go to platform revenue for payments and to the 5-match tier ("dust") for prizes.
5. **Annual plans.** Cash lands in `deferred_revenue` and is recognised in 12 monthly instalments by a daily cron. Contribution and prize-pool figures only ever count recognised instalments, so nothing is double counted.
6. **Tier shares.** 5-match 40 %, 4-match 35 %, 3-match 25 % of the pool (configurable, must total 100 %). Only the 5-match tier rolls over; unclaimed 4/3 tiers are held in reserve or added to the jackpot (setting).
7. **Equal split.** Winners within a tier split equally; remainder paise are distributed by a seeded deterministic order so results are reproducible and auditable.
8. **Match semantics.** Set semantics: duplicate score values in a player's five count once. Only the player's five scores frozen at approval count.
9. **Eligibility.** Active subscription at the cutoff **and** exactly five scores. Fewer than five → not entered (shown to the member with the reason).
10. **Score rule D4.** Adding a score older than every one of the current five when five exist is **rejected** (`older_than_window`) rather than silently inserted-then-dropped. One score per date.
11. **Draw lifecycle.** draft → simulated → approved → published (or cancelled). Approval freezes a sha256-hashed snapshot (TS and SQL hashes verified to match). Published draws are immutable (trigger-enforced).
12. **Simulation numbers are not reused.** Publishing draws fresh numbers over the frozen snapshot, so a simulation can't be used to "pick" an outcome.
13. **Randomness.** `crypto.randomInt`-based, unbiased Fisher-Yates. Weighted mode uses smoothed weights with a bounded fallback. The RNG is injectable for tests.
14. **Corrections after publish.** Not offered in the UI. A documented, audited manual procedure would be required (not implemented).
15. **Payouts.** The platform records that a transfer happened (unique reference); it does not move money.
16. **No public admin signup.** First admin via `npm run provision-admin`; further admins by DB promotion.
17. **No fabricated content.** Charities in the migration are placeholders; the demo badge is shown whenever demo data renders. Artwork is generated SVG. Legal pages are template text and need legal review.
