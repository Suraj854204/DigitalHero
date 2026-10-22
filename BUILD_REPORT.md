# Build report

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | 0 errors, 6 warnings |
| `npm test` | 158/158 pass |
| `npm run build` | success (Next 16) |
| Prod server smoke test | pass (see TESTING.md) |
| Playwright public-page overflow check | pass |

**Not verified:** any live Supabase, Stripe or AI call; deployment; authenticated browser flows. Nothing in this report claims otherwise.

**Bugs found during verification and fixed:** `"use server"` file exported a non-async constant (broke build); negative SVG radius from a signed shift; static prerender risk on authenticated areas (forced dynamic).
