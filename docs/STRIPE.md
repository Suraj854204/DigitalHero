# Stripe

Test mode only. Checkout is created server-side with metadata `user_id, plan, interval, charity_id, charity_bps`. Activation happens **only** from verified webhook events.

Handled events: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`.

Guarantees (unit + PGlite tested): bad signature → 400; duplicate event → no-op; failed processing → 500 and re-claimable on retry; invoice posted once; out-of-order events ignored via `last_event_created`; `invoice.paid` doesn't undo a scheduled cancellation; zero/invalid amounts never post money.

Local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`, put the printed `whsec_…` in `STRIPE_WEBHOOK_SECRET`, then `stripe trigger invoice.paid` or complete a test checkout. **This flow was not run here.** Customer Portal is used for card/cancel management (must be enabled in the Stripe dashboard).
