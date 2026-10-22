import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { asService, createDb } from "./helpers/pg.ts";

let db: PGlite;
before(async () => { db = await createDb(); });
after(async () => db.close());
const q = <T = any>(sql: string, p: unknown[] = []) => asService(db, () => db.query<T>(sql, p));
const claim = async (id: string) => (await q(`select public.claim_webhook_event($1, 'invoice.paid', 1) r`, [id])).rows[0].r;

test("processed events are never replayed", async () => {
  assert.equal(await claim("evt_a"), true);
  await q(`select public.finish_webhook_event('evt_a', 'processed')`);
  assert.equal(await claim("evt_a"), false);
});

test("a FAILED event is re-claimable so Stripe's retry can succeed", async () => {
  assert.equal(await claim("evt_b"), true);
  await q(`select public.finish_webhook_event('evt_b', 'failed', 'boom')`);
  assert.equal(await claim("evt_b"), true);
  assert.equal((await q(`select status, error from public.webhook_events where stripe_event_id = 'evt_b'`)).rows[0].status, "claimed");
});

test("an in-flight claim is not stolen, but a stale one (crashed worker) is", async () => {
  assert.equal(await claim("evt_c"), true);
  assert.equal(await claim("evt_c"), false); // still being processed
  await q(`update public.webhook_events set received_at = now() - interval '10 minutes' where stripe_event_id = 'evt_c'`);
  assert.equal(await claim("evt_c"), true);
});
