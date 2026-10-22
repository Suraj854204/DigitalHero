import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { addUser, asService, asUser, createDb, rejects } from "./helpers/pg.ts";

let db: PGlite;
let alice: string, bob: string, admin: string;

before(async () => {
  db = await createDb();
  alice = await addUser(db, "alice@example.test");
  bob = await addUser(db, "bob@example.test");
  admin = await addUser(db, "admin@example.test", "admin");
});
after(async () => db.close());

const day = (n: number) => {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
};
const add = (uid: string, date: string, value: number) =>
  asUser(db, uid, () => db.query<{ r: any }>(`select public.add_score($1::date, $2) r`, [date, value]));
const myScores = (uid: string) =>
  asUser(db, uid, () => db.query<{ score_date: string; value: number }>(`select to_char(score_date,'YYYY-MM-DD') score_date, value from public.scores order by score_date desc`));

test("score insert works through the RPC for an authenticated user", async () => {
  const r = await add(alice, day(10), 30);
  assert.equal(r.rows[0].r.score.value, 30);
  assert.equal(r.rows[0].r.evicted, null);
});

test("invalid values and future dates are rejected by SQL", async () => {
  await rejects(add(alice, day(9), 0), /INVALID_VALUE/);
  await rejects(add(alice, day(9), 46), /INVALID_VALUE/);
  await rejects(add(alice, "2099-01-01", 20), /FUTURE_DATE/);
});

test("duplicate date is rejected", async () => {
  await rejects(add(alice, day(10), 31), /DUPLICATE_DATE/);
});

test("sixth score atomically evicts the oldest; newest first; never more than five", async () => {
  for (const [n, v] of [[8, 31], [6, 32], [4, 33], [2, 34]] as const) await add(alice, day(n), v);
  assert.equal((await myScores(alice)).rows.length, 5);
  const r = await add(alice, day(1), 40);
  assert.equal(r.rows[0].r.evicted.score_date, day(10));
  const rows = (await myScores(alice)).rows;
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((x) => x.score_date), [day(1), day(2), day(4), day(6), day(8)]);
});

test("a round older than the whole window is rejected, not silently dropped", async () => {
  await rejects(add(alice, day(30), 20), /OLDER_THAN_WINDOW/);
  assert.equal((await myScores(alice)).rows.length, 5);
});

test("update + delete via RPC; edit may not create a duplicate date", async () => {
  const id = (await asUser(db, alice, () => db.query<{ id: string }>(`select id from public.scores order by score_date desc limit 1`))).rows[0].id;
  await asUser(db, alice, () => db.query(`select public.update_score($1::uuid, $2::date, 12)`, [id, day(1)]));
  await rejects(asUser(db, alice, () => db.query(`select public.update_score($1::uuid, $2::date, 12)`, [id, day(2)])), /DUPLICATE_DATE/);
  await asUser(db, alice, () => db.query(`select public.delete_score($1::uuid)`, [id]));
  assert.equal((await myScores(alice)).rows.length, 4);
});

test("UNAUTHORIZED: bob cannot see, edit or delete alice's scores", async () => {
  assert.equal((await myScores(bob)).rows.length, 0); // RLS hides alice's rows
  const aliceId = (await asService(db, () => db.query<{ id: string }>(`select id from public.scores where user_id = $1 limit 1`, [alice]))).rows[0].id;
  await rejects(asUser(db, bob, () => db.query(`select public.update_score($1::uuid, $2::date, 5)`, [aliceId, day(50)])), /NOT_FOUND/);
  await rejects(asUser(db, bob, () => db.query(`select public.delete_score($1::uuid)`, [aliceId])), /NOT_FOUND/);
});

test("clients cannot write scores directly or call the user-id-taking internals", async () => {
  await rejects(asUser(db, bob, () => db.query(`insert into public.scores (user_id, score_date, value) values ($1, $2, 10)`, [bob, day(3)])), /permission denied/);
  await rejects(asUser(db, bob, () => db.query(`select public._add_score($1::uuid, $2::date, 10)`, [alice, day(3)])), /permission denied/);
  await rejects(asUser(db, null, () => db.query(`select public.add_score($1::date, 10)`, [day(3)])), /permission denied/);
});

test("DB cap trigger refuses a sixth row even from a privileged writer", async () => {
  const carol = await addUser(db, "carol@example.test");
  for (let i = 1; i <= 5; i++) await asService(db, () => db.query(`insert into public.scores (user_id, score_date, value) values ($1, $2, 10)`, [carol, day(i)]));
  await rejects(asService(db, () => db.query(`insert into public.scores (user_id, score_date, value) values ($1, $2, 10)`, [carol, day(20)])), /SCORE_CAP/);
});

/* ------------------------------ RLS / privilege ------------------------------ */
test("a user cannot promote themselves or change their email", async () => {
  await rejects(asUser(db, bob, () => db.query(`update public.profiles set role = 'admin' where id = $1`, [bob])), /permission denied|FORBIDDEN/);
  await rejects(asUser(db, bob, () => db.query(`update public.profiles set status = 'suspended' where id = $1`, [bob])), /permission denied|FORBIDDEN/);
  const r = await asUser(db, bob, () => db.query<{ display_name: string }>(`update public.profiles set display_name = 'Bob' where id = $1 returning display_name`, [bob]));
  assert.equal(r.rows[0].display_name, "Bob");
  const role = await asService(db, () => db.query<{ role: string }>(`select role from public.profiles where id = $1`, [bob]));
  assert.equal(role.rows[0].role, "subscriber");
});

test("profiles: users see only themselves, admins see everyone", async () => {
  assert.equal((await asUser(db, bob, () => db.query(`select id from public.profiles`))).rows.length, 1);
  assert.ok((await asUser(db, admin, () => db.query(`select id from public.profiles`))).rows.length >= 4);
});

test("service-only functions are not callable by clients", async () => {
  for (const sql of [
    `select public.promote_to_admin('bob@example.test')`,
    `select public.post_monthly_payment('in_x', gen_random_uuid(), 1000, now())`,
    `select public.approve_draw(gen_random_uuid(), gen_random_uuid())`,
    `select public.publish_draw(gen_random_uuid(), gen_random_uuid(), '{}'::jsonb)`,
    `select public.mark_payout_paid(gen_random_uuid(), gen_random_uuid(), 'REF1234', null, null)`,
  ]) {
    await rejects(asUser(db, bob, () => db.query(sql)), /permission denied/);
  }
});

test("admin functions re-check the actor even when called with the service role", async () => {
  await rejects(asService(db, () => db.query(`select public.approve_draw(gen_random_uuid(), $1)`, [bob])), /FORBIDDEN/);
  await rejects(asService(db, () => db.query(`select public.approve_draw(gen_random_uuid(), null)`)), /FORBIDDEN/);
});

test("internal tables are invisible to clients: webhook_events, financial_ledger, audit_logs", async () => {
  await rejects(asUser(db, bob, () => db.query(`select * from public.webhook_events`)), /permission denied/);
  assert.equal((await asUser(db, bob, () => db.query(`select * from public.financial_ledger`))).rows.length, 0);
  assert.equal((await asUser(db, bob, () => db.query(`select * from public.audit_logs`))).rows.length, 0);
});

test("charity selection enforces the 10% floor and active charities", async () => {
  const ch = (await asService(db, () => db.query<{ id: string }>(`insert into public.charities (slug, name, is_demo) values ('demo-one','Demo One', true) returning id`))).rows[0].id;
  await rejects(asUser(db, bob, () => db.query(`select public.select_charity($1::uuid, 999)`, [ch])), /INVALID_PERCENTAGE/);
  await rejects(asUser(db, bob, () => db.query(`select public.select_charity($1::uuid, 10001)`, [ch])), /INVALID_PERCENTAGE/);
  await asUser(db, bob, () => db.query(`select public.select_charity($1::uuid, 1500)`, [ch]));
  const sel = await asUser(db, bob, () => db.query<{ contribution_bps: number }>(`select contribution_bps from public.charity_selections`));
  assert.equal(sel.rows[0].contribution_bps, 1500);
  await asService(db, () => db.query(`update public.charities set status = 'archived' where id = $1`, [ch]));
  await rejects(asUser(db, bob, () => db.query(`select public.select_charity($1::uuid, 1500)`, [ch])), /NOT_FOUND/);
  assert.equal((await asUser(db, null, () => db.query(`select id from public.charities where id = $1`, [ch]))).rows.length, 0);
});

test("audit log and financial ledger are append-only, even for the service role", async () => {
  await asService(db, () => db.query(`select public.write_audit($1, 'test.action', 'x', '1')`, [admin]));
  await rejects(asService(db, () => db.query(`update public.audit_logs set action = 'tampered'`)), /append-only/);
  await rejects(asService(db, () => db.query(`delete from public.audit_logs`)), /append-only/);
});
