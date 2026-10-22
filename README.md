# Digital Heroes

A subscription platform where members record their latest golf scores, support a charity they choose, and take part in a monthly prize draw. Built for the Digital Heroes PRD (Level 1).

**Stack:** Next.js 16 (App Router, TypeScript strict) · Tailwind CSS 4 · Supabase (Auth, Postgres, Storage, RLS) · Stripe (test mode) · Zod · React Hook Form · Recharts · Motion.

> **Honest status.** Everything below was built and tested *locally*. Supabase, Stripe and the AI provider were **not** reached from the build environment, so those integrations are implemented and unit/PGlite-tested but **not live-verified**. See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) and [`BUILD_REPORT.md`](BUILD_REPORT.md).

## Quick start

```bash
npm install
cp .env.example .env.local     # fill in values, see docs/SETUP.md
npm run dev                    # http://localhost:3000
```

Without Supabase keys the public site runs with clearly-labelled demo charities and auth routes redirect to a setup notice.

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | all tests (engine, scores, security, AI, Postgres/RLS via PGlite) |
| `npm run build` | production build |
| `npm run provision-admin` | creates the first admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD` |
| `npm run seed` | optional labelled demo subscribers (needs `ALLOW_DEMO_SEED=true`) |

## Documentation

`docs/`: REQUIREMENTS · DECISIONS · ARCHITECTURE · DATABASE · SECURITY · SETUP · DEPLOYMENT · STRIPE · AI_FEATURES · TESTING · IMPLEMENTATION_STATUS.

## Key design points

- Money is **integer paise** and percentages are **basis points**. No floats for money anywhere.
- The draw is a **state machine** (draft → simulated → approved → published). Simulation never writes money. Approval freezes a hashed snapshot. Publishing is atomic, idempotent and re-verified in SQL.
- A **double-entry ledger** with a deferred balance constraint backs every figure; reconciliation views are shown in the admin Reports page.
- Authorization is **server-side**: Postgres RLS + column grants, and `SECURITY DEFINER` functions for business rules. The service-role key never reaches the browser. There is no public admin signup.
