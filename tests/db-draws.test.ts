import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { addUser, asService, asUser, createDb, rejects } from "./helpers/pg.ts";
import {
  buildParticipants,
  computeDrawResult,
  hashSnapshot,
  scriptedRandomSource,
  simulateDraw,
  splitPayment,
  toPublishPayload,
  seededRandomSource,
  type CandidateUser,
  type DrawConfig,
  type FrozenParticipant,
  type TierConfig,
} from "../src/lib/draw-engine/index.ts";

let db: PGlite;
let admin: string;
const users: Record<string, string> = {};
const subIds: Record<string, string> = {};
let charityId: string;

const svc = <T>(fn: () => Promise<T>) => asService(db, fn);
const q = <T = any>(sql: string, params: unknown[] = []) => svc(() => db.query<T>(sql, params));
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
let invoiceSeq = 0;

async function setupUser(name: string, scoreValues: number[], opts: { status?: string; charityBps?: number } = {}) {
  const id = await addUser(db, `${name}@example.test`);
  users[name] = id;
  const sub = await q<{ id: string }>(
    `insert into public.subscriptions (user_id, plan_id, status, current_period_end) values ($1, 'monthly', $2, now() + interval '30 days') returning id`,
    [id, opts.status ?? "active"],
  );
  subIds[name] = sub.rows[0].id;
  for (let i = 0; i < scoreValues.length; i++) {
    await q(`insert into public.scores (user_id, score_date, value) values ($1, $2, $3)`, [id, day(i + 1), scoreValues[i]]);
  }
  await q(`insert into public.charity_selections (user_id, charity_id, contribution_bps) values ($1, $2, $3)`, [id, charityId, opts.charityBps ?? 1000]);
  return id;
}

const pay = (name: string, amount = 99_900) =>
  q<{ r: boolean }>(`select public.post_monthly_payment($1, $2, $3, now()) r`, [`in_${++invoiceSeq}`, subIds[name], amount]);

before(async () => {
  db = await createDb();
  admin = await addUser(db, "admin@example.test", "admin");
  charityId = (await q<{ id: string }>(`insert into public.charities (slug, name, is_demo) values ('demo-charity','Demo Charity', true) returning id`)).rows[0].id;
  await setupUser("jackpot", [1, 2, 3, 4, 5], { charityBps: 1500 });
  await setupUser("four-a", [1, 2, 3, 4, 40]);
  await setupUser("four-b", [1, 2, 3, 4, 41]);
  await setupUser("three", [1, 2, 3, 30, 31]);
  await setupUser("none", [30, 31, 32, 33, 34]);
  await setupUser("short", [1, 2, 3, 4]); // only four scores -> ineligible
  await setupUser("lapsed", [1, 2, 3, 4, 5], { status: "lapsed" }); // no paid access -> ineligible
});
after(async () => db.close());

/* ---------------------------- payments / money ---------------------------- */
test("monthly payment is split in integer paise: 10% charity floor, 50% pool, remainder platform", async () => {
  assert.equal((await pay("four-a")).rows[0].r, true);
  const c = (await q(`select * from public.contributions where user_id = $1`, [users["four-a"]])).rows[0];
  assert.deepEqual([c.amount_minor, c.charity_minor, c.pool_minor, c.platform_minor].map(Number), [99_900, 9_990, 49_950, 39_960]);
  assert.equal(c.charity_id, charityId);
});

test("a higher voluntary charity percentage is honoured", async () => {
  await pay("jackpot");
  const c = (await q(`select charity_minor, charity_bps from public.contributions where user_id = $1`, [users["jackpot"]])).rows[0];
  assert.equal(Number(c.charity_bps), 1500);
  assert.equal(Number(c.charity_minor), 14_985);
});

test("replaying the same invoice does not post money twice (idempotent)", async () => {
  const inv = "in_replay";
  const first = await q(`select public.post_monthly_payment($1, $2, 99900, now()) r`, [inv, subIds["four-b"]]);
  const again = await q(`select public.post_monthly_payment($1, $2, 99900, now()) r`, [inv, subIds["four-b"]]);
  assert.equal(first.rows[0].r, true);
  assert.equal(again.rows[0].r, false);
  assert.equal((await q(`select count(*)::int n from public.contributions where invoice_id = $1`, [inv])).rows[0].n, 1);
});

test("PARITY: SQL split equals the TypeScript split for 300 random amounts and percentages", async () => {
  const rng = seededRandomSource(31);
  for (let i = 0; i < 300; i++) {
    const amount = rng.int(5_000_000);
    const charityBps = 1000 + rng.int(4001);
    const poolBps = rng.int(10_001 - charityBps);
    const ts = splitPayment(amount, { charityBps, poolBps });
    const sql = (await q(`select * from public.split_payment_sql($1::bigint, $2, $3)`, [amount, charityBps, poolBps])).rows[0];
    assert.deepEqual([Number(sql.charity_minor), Number(sql.pool_minor), Number(sql.platform_minor)], [ts.charityMinor, ts.poolMinor, ts.platformMinor]);
  }
});

test("annual policy: whole payment deferred, 12 instalments recognised once, nothing double counted", async () => {
  const total = 999_999;
  await q(`select public.post_annual_payment('in_annual', $1, $2, now())`, [subIds["three"], total]);
  // only instalment 1 is due today
  const rec = (await q(`select count(*) filter (where recognized_at is not null)::int done, sum(amount_minor)::bigint s from public.recognition_schedule where invoice_id = 'in_annual'`)).rows[0];
  assert.equal(rec.done, 1);
  assert.equal(Number(rec.s), total);
  assert.equal((await q(`select count(*)::int n from public.contributions where kind = 'subscription_annual_installment' and invoice_id = 'in_annual'`)).rows[0].n, 1);
  // run the recognition job far in the future twice: idempotent
  const a = (await q(`select public.recognize_due_installments(now() + interval '13 months') n`)).rows[0].n;
  const b = (await q(`select public.recognize_due_installments(now() + interval '13 months') n`)).rows[0].n;
  assert.equal(a, 11);
  assert.equal(b, 0);
  const c = (await q(`select sum(amount_minor)::bigint amt, sum(charity_minor + pool_minor + platform_minor)::bigint parts, count(*)::int n from public.contributions where invoice_id = 'in_annual'`)).rows[0];
  assert.equal(c.n, 12);
  assert.equal(Number(c.amt), total);
  assert.equal(Number(c.parts), total);
  const deferred = (await q(`select credit_balance_minor b from public.v_ledger_balances where account = 'deferred_revenue'`)).rows[0];
  assert.equal(Number(deferred.b), 0);
});

test("an unbalanced ledger group cannot be committed", async () => {
  await rejects(
    db.exec(`
      set role service_role; begin;
      insert into public.ledger_groups (id, idempotency_key, kind) values ('00000000-0000-0000-0000-0000000000aa', 'bad', 'test');
      insert into public.financial_ledger (group_id, account, direction, amount_minor) values ('00000000-0000-0000-0000-0000000000aa', 'cash', 'debit', 100);
      commit;`),
    /unbalanced/,
  ).finally(async () => {
    await db.exec(`rollback; reset role;`).catch(() => {});
  });
});

/* ------------------------------ draw lifecycle ----------------------------- */
const TIER_CFG: TierConfig = { shareBps: { 5: 4000, 4: 3500, 3: 2500 }, rollover: { 5: true, 4: false, 3: false }, unclaimedPolicy: "reserve" };

async function newDraw(month: string): Promise<string> {
  const r = await q<{ id: string }>(
    `insert into public.draws (title, period_month, eligibility_cutoff, tier_config, created_by)
     values ($1, $2, clock_timestamp(), $3::jsonb, $4) returning id`,
    [`Draw ${month}`, month, JSON.stringify(TIER_CFG), admin],
  );
  return r.rows[0].id;
}

async function snapshotRows(drawId: string): Promise<FrozenParticipant[]> {
  const rows = (await q(`select user_id, position, to_char(score_date,'YYYY-MM-DD') d, value from public.draw_score_snapshots where draw_id = $1 order by user_id, position`, [drawId])).rows;
  const by = new Map<string, FrozenParticipant>();
  for (const r of rows) {
    if (!by.has(r.user_id)) by.set(r.user_id, { userId: r.user_id, scores: [] });
    (by.get(r.user_id)!.scores as any[]).push({ id: `${r.user_id}-${r.position}`, scoreDate: r.d, value: r.value });
  }
  return [...by.values()];
}

async function configFor(drawId: string): Promise<DrawConfig> {
  const d = (await q(`select pool_minor, jackpot_carry_in_minor, tier_config, mode from public.draws where id = $1`, [drawId])).rows[0];
  return { drawId, mode: d.mode, poolMinor: Number(d.pool_minor), jackpotCarryInMinor: Number(d.jackpot_carry_in_minor), tierConfig: d.tier_config };
}

test("PARITY: SQL eligibility equals the TypeScript eligibility rules", async () => {
  const cutoff = new Date((await q(`select clock_timestamp() t`)).rows[0].t);
  const sqlRows = (await q(`select * from public.compute_eligible_snapshot(clock_timestamp())`)).rows;
  const sqlUsers = new Set(sqlRows.map((r) => r.user_id));
  const candidates: CandidateUser[] = [];
  for (const [name, id] of Object.entries(users)) {
    const scores = (await q(`select id, to_char(score_date,'YYYY-MM-DD') d, value from public.scores where user_id = $1`, [id])).rows.map((s) => ({ id: s.id, scoreDate: s.d, value: s.value }));
    const hist = (await q(`select status, effective_from, effective_until, paid_until from public.subscription_history where user_id = $1 order by id desc limit 1`, [id])).rows[0];
    candidates.push({
      userId: id,
      scores,
      subscription: hist && { status: hist.status, activeFrom: new Date(hist.effective_from).toISOString(), activeUntil: hist.paid_until ? new Date(hist.paid_until).toISOString() : null },
    });
    void name;
  }
  const ts = buildParticipants(candidates, new Date(cutoff.getTime() + 1000));
  assert.deepEqual(new Set(ts.participants.map((p) => p.userId)), sqlUsers);
  assert.equal(sqlUsers.size, 5); // jackpot, four-a, four-b, three, none
  assert.ok(!sqlUsers.has(users["short"]) && !sqlUsers.has(users["lapsed"]));
  // and the five newest scores per user are identical
  for (const p of ts.participants) {
    const mine = sqlRows.filter((r) => r.user_id === p.userId).sort((a, b) => a.pos - b.pos).map((r) => r.value);
    assert.deepEqual(p.scores.map((s) => s.value), mine);
  }
});

let drawId1: string;
const NUMS_1_5 = () => scriptedRandomSource([0, 0, 0, 0, 0]);
const NUMS_10_14 = () => scriptedRandomSource([9, 9, 9, 9, 9]);

test("a draw cannot skip the state machine (publish/approve straight from draft)", async () => {
  drawId1 = await newDraw("2026-08-01");
  await rejects(q(`select public.approve_draw($1, $2)`, [drawId1, admin]), /only a simulated draw can be approved/);
  await rejects(q(`select public.publish_draw($1, $2, '{}'::jsonb)`, [drawId1, admin]), /only an approved draw can be published/);
  await rejects(q(`update public.draws set status = 'published' where id = $1`, [drawId1]), /TRANSITION|published_has_result/);
});

test("simulation records an outcome but moves no money", async () => {
  const before = (await q(`select (select count(*) from public.financial_ledger)::int l, (select count(*) from public.winnings)::int w, (select count(*) from public.jackpot_ledger)::int j`)).rows[0];
  const snap = (await q(`select * from public.compute_eligible_snapshot(clock_timestamp())`)).rows;
  const parts = new Map<string, FrozenParticipant>();
  for (const r of snap) {
    if (!parts.has(r.user_id)) parts.set(r.user_id, { userId: r.user_id, scores: [] });
    (parts.get(r.user_id)!.scores as any[]).push({ id: `${r.user_id}-${r.pos}`, scoreDate: r.score_date.toISOString?.().slice(0, 10) ?? String(r.score_date), value: r.value });
  }
  const pool = Number((await q(`select public.unallocated_pool_minor(clock_timestamp()) v`)).rows[0].v);
  const sim = simulateDraw({ drawId: drawId1, mode: "random", poolMinor: pool, jackpotCarryInMinor: 0, tierConfig: TIER_CFG }, [...parts.values()], NUMS_1_5());
  assert.equal(sim.simulated, true);
  await q(`select public.record_simulation($1, $2, $3::smallint[], 'scripted', $4::jsonb)`, [drawId1, admin, sim.winningNumbers, JSON.stringify({ participants: sim.participantCount })]);
  const after = (await q(`select (select count(*) from public.financial_ledger)::int l, (select count(*) from public.winnings)::int w, (select count(*) from public.jackpot_ledger)::int j`)).rows[0];
  assert.deepEqual(after, before);
  assert.equal((await q(`select status from public.draws where id = $1`, [drawId1])).rows[0].status, "simulated");
  assert.equal((await q(`select winning_numbers from public.draws where id = $1`, [drawId1])).rows[0].winning_numbers, null);
});

test("approval freezes snapshot, pool and jackpot; hash matches the TypeScript hash", async () => {
  const r = (await q(`select public.approve_draw($1, $2) r`, [drawId1, admin])).rows[0].r;
  assert.equal(r.participant_count, 5);
  const participants = await snapshotRows(drawId1);
  assert.equal(participants.length, 5);
  assert.equal(r.snapshot_hash, hashSnapshot(participants)); // SQL sha256 == TS sha256
  const d = (await q(`select pool_minor, jackpot_carry_in_minor from public.draws where id = $1`, [drawId1])).rows[0];
  const expectedPool = (await q(`select sum(pool_minor)::bigint s from public.contributions where draw_id = $1`, [drawId1])).rows[0].s;
  assert.equal(Number(d.pool_minor), Number(expectedPool));
  assert.ok(Number(d.pool_minor) > 0);
  assert.equal(Number(d.jackpot_carry_in_minor), 0);
});

test("only one draw may be approved at a time; snapshots cannot be edited by anyone once frozen", async () => {
  const other = await newDraw("2026-07-01");
  await q(`select public.record_simulation($1, $2, '{1,2,3,4,5}'::smallint[], 'scripted', '{}'::jsonb)`, [other, admin]);
  await rejects(q(`select public.approve_draw($1, $2)`, [other, admin]), /DRAW_IN_FLIGHT/);
  await rejects(q(`update public.draw_score_snapshots set value = 45 where draw_id = $1`, [drawId1]), /snapshots are written only/);
  await rejects(q(`delete from public.draw_participants where draw_id = $1`, [drawId1]), /snapshots are written only/);
  await q(`update public.draws set status = 'cancelled' where id = $1`, [other]);
});

test("TAMPERING: publish refuses forged payloads (match, amount, numbers, snapshot hash) and the draw stays approved", async () => {
  const participants = await snapshotRows(drawId1);
  const good = computeDrawResult(await configFor(drawId1), participants, NUMS_1_5());
  const base = toPublishPayload(good);
  const attempt = (mutate: (p: any) => void) => {
    const p = structuredClone(base);
    mutate(p);
    return q(`select public.publish_draw($1, $2, $3::jsonb)`, [drawId1, admin, JSON.stringify(p)]);
  };
  const mineUser = users["none"];
  await rejects(attempt((p) => { p.matches.find((m: any) => m.userId === mineUser).matches = 5; p.matches.find((m: any) => m.userId === mineUser).tier = 5; }), /RESULT_MISMATCH/);
  await rejects(attempt((p) => { p.payouts[0].amountMinor += 1; }), /RESULT_MISMATCH/);
  await rejects(attempt((p) => { p.winningNumbers = [10, 11, 12, 13, 14]; }), /RESULT_MISMATCH/);
  await rejects(attempt((p) => { p.winningNumbers = [1, 1, 2, 3, 4]; }), /INVALID_NUMBERS/);
  await rejects(attempt((p) => { p.reserveMinor += 1; }), /RESULT_MISMATCH/);
  await rejects(attempt((p) => { p.snapshotHash = "0".repeat(64); }), /SNAPSHOT_MISMATCH/);
  await rejects(q(`select public.publish_draw($1, $2, $3::jsonb)`, [drawId1, users["jackpot"], JSON.stringify(base)]), /FORBIDDEN/);
  const st = (await q(`select status from public.draws where id = $1`, [drawId1])).rows[0].status;
  assert.equal(st, "approved");
  assert.equal((await q(`select count(*)::int n from public.winnings`)).rows[0].n, 0);
});

let published: ReturnType<typeof computeDrawResult>;
test("PUBLISH: atomic write of results, winnings, ledgers, jackpot, notifications and audit", async () => {
  const participants = await snapshotRows(drawId1);
  published = computeDrawResult(await configFor(drawId1), participants, NUMS_1_5());
  const out = (await q(`select public.publish_draw($1, $2, $3::jsonb) r`, [drawId1, admin, JSON.stringify(toPublishPayload(published))])).rows[0].r;
  assert.equal(out.status, "published");
  const d = (await q(`select status, winning_numbers, result_hash from public.draws where id = $1`, [drawId1])).rows[0];
  assert.equal(d.status, "published");
  assert.deepEqual(d.winning_numbers, [1, 2, 3, 4, 5]);
  assert.equal(d.result_hash, published.resultHash);

  const w = (await q(`select u.email, w.tier, w.amount_minor from public.winnings w join public.profiles u on u.id = w.user_id where w.draw_id = $1 order by w.tier desc, u.email`, [drawId1])).rows;
  assert.equal(w.length, 4); // jackpot, four-a, four-b, three
  const total = w.reduce((a, r) => a + Number(r.amount_minor), 0);
  assert.equal(total, published.prizes.payouts.reduce((a, p) => a + p.amountMinor, 0));
  const pool = Number((await q(`select pool_minor from public.draws where id = $1`, [drawId1])).rows[0].pool_minor);
  // 5-match winner got 40% of pool (+dust); tier 4 split two ways; tier 3 got 25%
  assert.equal(Number(w.find((r) => r.tier === 5)!.amount_minor), published.prizes.tiers[5].fundMinor);
  const four = w.filter((r) => r.tier === 4).map((r) => Number(r.amount_minor));
  assert.ok(Math.abs(four[0] - four[1]) <= 1);
  assert.equal(four[0] + four[1], Math.floor((pool * 3500) / 10000));
  assert.equal(total + Number((await q(`select coalesce(sum(delta_minor),0) j from public.jackpot_ledger`)).rows[0].j) + 0 <= pool, true);
  assert.equal((await q(`select count(*)::int n from public.draw_matches where draw_id = $1`, [drawId1])).rows[0].n, 5);
  assert.equal((await q(`select count(*)::int n from public.notifications where kind = 'winning'`)).rows[0].n, 4);
  assert.equal((await q(`select count(*)::int n from public.audit_logs where action = 'draw.published'`)).rows[0].n, 1);
});

test("PUBLISH IS IDEMPOTENT: a second call returns already_published and writes nothing", async () => {
  const counts = () => q(`select (select count(*) from public.winnings)::int w, (select count(*) from public.financial_ledger)::int l, (select count(*) from public.draw_ledger_entries)::int e, (select count(*) from public.audit_logs)::int a`);
  const before = (await counts()).rows[0];
  const again = (await q(`select public.publish_draw($1, $2, $3::jsonb) r`, [drawId1, admin, JSON.stringify(toPublishPayload(published))])).rows[0].r;
  assert.equal(again.status, "already_published");
  assert.deepEqual((await counts()).rows[0], before);
});

test("IMMUTABLE after publication: draw, results, winnings amounts, snapshots", async () => {
  await rejects(q(`update public.draws set winning_numbers = '{6,7,8,9,10}' where id = $1`, [drawId1]), /IMMUTABLE/);
  await rejects(q(`update public.draws set status = 'draft' where id = $1`, [drawId1]), /IMMUTABLE/);
  await rejects(q(`delete from public.draws where id = $1`, [drawId1]), /only draft draws/);
  await rejects(q(`update public.winnings set amount_minor = amount_minor + 1`), /IMMUTABLE/);
  await rejects(q(`delete from public.winnings`), /append-only/);
  await rejects(q(`update public.draw_matches set match_count = 5`), /append-only/);
  await rejects(q(`update public.prize_allocations set paid_minor = 0`), /append-only/);
  await rejects(q(`delete from public.draw_ledger_entries`), /append-only/);
  await rejects(q(`update public.draw_score_snapshots set value = 1 where draw_id = $1`, [drawId1]), /IMMUTABLE/);
  await rejects(q(`select public.unapprove_draw($1, $2, 'trying to reopen')`, [drawId1, admin]), /only an approved/);
});

test("PRIVACY: a participant sees only their own snapshot/result; others' rows are invisible", async () => {
  const mine = await asUser(db, users["none"], () => db.query(`select user_id from public.draw_score_snapshots`));
  assert.ok(mine.rows.every((r: any) => r.user_id === users["none"]));
  assert.equal(mine.rows.length, 5);
  assert.equal((await asUser(db, users["none"], () => db.query(`select * from public.draw_matches`))).rows.length, 1);
  assert.equal((await asUser(db, users["none"], () => db.query(`select * from public.winnings`))).rows.length, 0);
  assert.equal((await asUser(db, null, () => db.query(`select id from public.draws`))).rows.length, 1); // anon: published only
  assert.equal((await asUser(db, null, () => db.query(`select * from public.prize_allocations`))).rows.length, 3);
  await rejects(asUser(db, null, () => db.query(`select * from public.draw_score_snapshots`)), /permission denied/);
});

/* ---------------------------- claims and payouts --------------------------- */
let winningId: string;
test("evidence: only the winner can submit, into their own folder; claim moves to pending_review", async () => {
  winningId = (await q(`select id from public.winnings where user_id = $1`, [users["jackpot"]])).rows[0].id;
  const u = users["jackpot"];
  await rejects(asUser(db, users["none"], () => db.query(`select public.submit_evidence($1::uuid, $2, 'image/png', 1000)`, [winningId, `${users["none"]}/${winningId}/a.png`])), /NOT_FOUND/);
  await rejects(asUser(db, u, () => db.query(`select public.submit_evidence($1::uuid, $2, 'image/png', 1000)`, [winningId, `${users["none"]}/${winningId}/a.png`])), /INVALID_PATH/);
  await rejects(asUser(db, u, () => db.query(`select public.submit_evidence($1::uuid, $2, 'application/pdf', 1000)`, [winningId, `${u}/${winningId}/a.pdf`])), /mime_type|check/);
  await asUser(db, u, () => db.query(`select public.submit_evidence($1::uuid, $2, 'image/png', 1000)`, [winningId, `${u}/${winningId}/shot1.png`]));
  assert.equal((await q(`select claim_status from public.winnings where id = $1`, [winningId])).rows[0].claim_status, "pending_review");
  await rejects(asUser(db, u, () => db.query(`select public.submit_evidence($1::uuid, $2, 'image/png', 1000)`, [winningId, `${u}/${winningId}/shot2.png`])), /cannot be submitted/);
});

test("evidence visibility: other users see nothing; admin sees it", async () => {
  assert.equal((await asUser(db, users["none"], () => db.query(`select * from public.winner_evidence`))).rows.length, 0);
  assert.equal((await asUser(db, users["jackpot"], () => db.query(`select * from public.winner_evidence`))).rows.length, 1);
  assert.equal((await asUser(db, admin, () => db.query(`select * from public.winner_evidence`))).rows.length, 1);
});

test("a winner can never approve or pay their own claim", async () => {
  const u = users["jackpot"];
  await rejects(asUser(db, u, () => db.query(`update public.winnings set claim_status = 'approved' where id = $1`, [winningId])), /permission denied/);
  await rejects(asUser(db, u, () => db.query(`update public.winner_evidence set review_status = 'approved'`)), /permission denied/);
  await rejects(asUser(db, u, () => db.query(`select public.review_evidence(gen_random_uuid(), $1, true, null)`, [u])), /permission denied/);
  await rejects(q(`select public.review_evidence((select id from public.winner_evidence limit 1), $1, true, null)`, [u]), /FORBIDDEN/);
  // even the service role cannot jump pending_review -> paid at table level
  await rejects(q(`update public.winnings set claim_status = 'paid' where id = $1`, [winningId]), /TRANSITION/);
});

test("rejection needs a reason, notifies the winner and allows resubmission", async () => {
  const ev = (await q(`select id from public.winner_evidence where winning_id = $1`, [winningId])).rows[0].id;
  await rejects(q(`select public.review_evidence($1, $2, false, '')`, [ev, admin]), /REASON_REQUIRED/);
  await q(`select public.review_evidence($1, $2, false, 'Screenshot is cropped, the date is not visible')`, [ev, admin]);
  assert.equal((await q(`select claim_status from public.winnings where id = $1`, [winningId])).rows[0].claim_status, "rejected");
  await rejects(q(`select public.review_evidence($1, $2, true, null)`, [ev, admin]), /already been reviewed/);
  const u = users["jackpot"];
  await asUser(db, u, () => db.query(`select public.submit_evidence($1::uuid, $2, 'image/png', 2000)`, [winningId, `${u}/${winningId}/shot2.png`]));
  assert.equal((await q(`select claim_status from public.winnings where id = $1`, [winningId])).rows[0].claim_status, "pending_review");
  const ev2 = (await q(`select id from public.winner_evidence where winning_id = $1 and review_status = 'pending'`, [winningId])).rows[0].id;
  await q(`select public.review_evidence($1, $2, true, null)`, [ev2, admin]);
  assert.equal((await q(`select claim_status from public.winnings where id = $1`, [winningId])).rows[0].claim_status, "approved");
});

test("payout: cannot skip queueing; queue is idempotent; paid needs a unique external reference", async () => {
  await rejects(q(`select public.mark_payout_paid($1, $2, 'UTR123456', 'upi', null)`, [winningId, admin]), /cannot be marked paid/);
  const p1 = (await q(`select public.queue_payout($1, $2) id`, [winningId, admin])).rows[0].id;
  const p2 = (await q(`select public.queue_payout($1, $2) id`, [winningId, admin])).rows[0].id;
  assert.equal(p1, p2);
  await rejects(q(`select public.mark_payout_paid($1, $2, 'x', 'upi', null)`, [winningId, admin]), /REFERENCE_REQUIRED/);
  const r = (await q(`select public.mark_payout_paid($1, $2, 'UTR123456', 'upi', 'paid via UPI') r`, [winningId, admin])).rows[0].r;
  assert.equal(r.status, "paid");
  const again = (await q(`select public.mark_payout_paid($1, $2, 'UTR123456', 'upi', null) r`, [winningId, admin])).rows[0].r;
  assert.equal(again.idempotent, true);
  await rejects(q(`select public.mark_payout_paid($1, $2, 'DIFFERENT99', 'upi', null)`, [winningId, admin]), /PAYOUT_REFERENCE_CONFLICT/);
  assert.equal((await q(`select claim_status from public.winnings where id = $1`, [winningId])).rows[0].claim_status, "paid");
  assert.equal((await q(`select count(*)::int n from public.ledger_groups where idempotency_key = $1`, ["payout:" + winningId])).rows[0].n, 1);
  await rejects(q(`update public.winnings set claim_status = 'payout_pending' where id = $1`, [winningId]), /TRANSITION/);
});

/* --------------------------- jackpot rollover chain ------------------------ */
test("JACKPOT ROLLOVER: a no-winner draw carries the jackpot forward and the next winner collects it", async () => {
  // fresh contributions for September
  for (const n of ["jackpot", "four-a", "four-b", "three", "none"]) await pay(n);
  const d2 = await newDraw("2026-09-01");
  await q(`select public.record_simulation($1, $2, '{10,11,12,13,14}'::smallint[], 'scripted', '{}'::jsonb)`, [d2, admin]);
  const ap = (await q(`select public.approve_draw($1, $2) r`, [d2, admin])).rows[0].r;
  assert.equal(Number(ap.jackpot_carry_in_minor), 0);
  const res2 = computeDrawResult(await configFor(d2), await snapshotRows(d2), NUMS_10_14());
  assert.equal(res2.prizes.payouts.length, 0);
  await q(`select public.publish_draw($1, $2, $3::jsonb)`, [d2, admin, JSON.stringify(toPublishPayload(res2))]);
  const carried = Number((await q(`select public.public_jackpot_balance() b`)).rows[0].b);
  assert.equal(carried, res2.prizes.jackpotCarryOutMinor);
  assert.ok(carried > 0);
  assert.equal(res2.prizes.reserveMinor + carried, Number((await q(`select pool_minor from public.draws where id = $1`, [d2])).rows[0].pool_minor));

  // October: someone matches 5 and receives carry-in + new allocation
  for (const n of ["jackpot", "four-a", "four-b", "three", "none"]) await pay(n);
  const d3 = await newDraw("2026-10-01");
  await q(`select public.record_simulation($1, $2, '{1,2,3,4,5}'::smallint[], 'scripted', '{}'::jsonb)`, [d3, admin]);
  const ap3 = (await q(`select public.approve_draw($1, $2) r`, [d3, admin])).rows[0].r;
  assert.equal(Number(ap3.jackpot_carry_in_minor), carried);
  const res3 = computeDrawResult(await configFor(d3), await snapshotRows(d3), NUMS_1_5());
  assert.equal(res3.prizes.tiers[5].fundMinor, res3.prizes.tiers[5].allocationMinor + carried);
  await q(`select public.publish_draw($1, $2, $3::jsonb)`, [d3, admin, JSON.stringify(toPublishPayload(res3))]);
  assert.equal(Number((await q(`select public.public_jackpot_balance() b`)).rows[0].b), 0);
  const win5 = (await q(`select amount_minor from public.winnings where draw_id = $1 and tier = 5`, [d3])).rows[0];
  assert.equal(Number(win5.amount_minor), res3.prizes.tiers[5].fundMinor);
});

test("RECONCILIATION: every ledger figure ties back to its operational source", async () => {
  const rows = (await q(`select check_name, ledger_minor, source_minor from public.v_reconciliation`)).rows;
  for (const r of rows) assert.equal(Number(r.ledger_minor), Number(r.source_minor), `${r.check_name}: ledger ${r.ledger_minor} vs source ${r.source_minor}`);
  // global double-entry invariant: total debits == total credits
  const t = (await q(`select sum(amount_minor) filter (where direction='debit')::bigint d, sum(amount_minor) filter (where direction='credit')::bigint c from public.financial_ledger`)).rows[0];
  assert.equal(Number(t.d), Number(t.c));
});

test("webhook event claims are idempotent in SQL", async () => {
  assert.equal((await q(`select public.claim_webhook_event('evt_sql_1', 'invoice.paid', 1) r`)).rows[0].r, true);
  assert.equal((await q(`select public.claim_webhook_event('evt_sql_1', 'invoice.paid', 1) r`)).rows[0].r, false);
});

test("subscription events: out-of-order updates are ignored by the SQL guard", async () => {
  const id = subIds["none"];
  assert.equal((await q(`select public.apply_subscription_state($1, 'past_due', null, null, false, 2000) r`, [id])).rows[0].r, true);
  assert.equal((await q(`select public.apply_subscription_state($1, 'active', null, null, false, 1500) r`, [id])).rows[0].r, false);
  assert.equal((await q(`select status from public.subscriptions where id = $1`, [id])).rows[0].status, "past_due");
});

test("admin bootstrap: promote_to_admin is service-only and audited", async () => {
  const u = await addUser(db, "newadmin@example.test");
  assert.equal((await q(`select public.promote_to_admin('newadmin@example.test') r`)).rows[0].r, true);
  assert.equal((await q(`select role from public.profiles where id = $1`, [u])).rows[0].role, "admin");
  assert.equal((await q(`select public.promote_to_admin('nobody@example.test') r`)).rows[0].r, false);
  assert.ok((await q(`select count(*)::int n from public.audit_logs where action = 'admin.promoted'`)).rows[0].n >= 1);
});
