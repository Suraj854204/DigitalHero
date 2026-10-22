import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./helpers/pg.ts";

test("migrations apply cleanly to a real Postgres", async () => {
  const db = await createDb();
  const t = await db.query<{ n: number }>(
    `select count(*)::int n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  assert.ok(t.rows[0].n >= 25, `tables: ${t.rows[0].n}`);
  const rls = await db.query<{ relname: string }>(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
  );
  assert.deepEqual(rls.rows.map((r) => r.relname), [], "every public table must have RLS enabled");
  await db.close();
});
