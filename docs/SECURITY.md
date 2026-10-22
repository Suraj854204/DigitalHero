# Security

**Three access tiers**
1. *Anon / authenticated* (browser): RLS + column grants only. Members read their own rows; public reads are limited to active charities, published draws and public settings.
2. *Service role* (server only): used by admin pages, webhook, cron, evidence signed URLs. `import "server-only"` guards it; the key has no `NEXT_PUBLIC_` prefix.
3. *Owner*: DB owner/migrations only.

**Controls**
- Admin pages call `requireAdminPage` (404 for non-admins); admin actions use `requireAdminAction`; the CSV export route re-checks the role.
- Role/status/email can't be self-edited (trigger + column grants; tested).
- Stripe webhook: raw-body signature verification, idempotent event claims, activation only from verified events, never from the success redirect.
- Cron endpoint: Bearer `CRON_SECRET`, constant-time compare.
- Uploads: 5 MB, magic-byte sniffing (PNG/JPEG/WebP), private bucket, path scoped to user id, admin views via 5-minute signed URLs.
- CSV export neutralises spreadsheet formulas. `safeNext` blocks open redirects. Zod validates all inputs.
- Security headers (nosniff, frame deny, referrer, permissions policy). Audit log is append-only.
- Destructive/final actions use confirm dialogs; publish requires typing PUBLISH.

**Known limitations**
- No Content-Security-Policy header yet (Next inline scripts need a nonce setup).
- Rate limiter is in-memory per instance (best-effort on serverless).
- No MFA for admins; no automated dependency/secret scanning configured.
- RLS was tested on PGlite with a stub auth schema, not on a live Supabase project.
