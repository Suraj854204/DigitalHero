/**
 * Real-Postgres harness (PGlite = Postgres compiled to WASM). Applies the actual migration files
 * on top of minimal stand-ins for the Supabase pieces (auth schema, roles, storage).
 * Limitation: PGlite is single-connection, so true parallel transactions cannot be exercised;
 * lock/idempotency logic is verified sequentially.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(import.meta.dirname, "../../supabase/migrations");

const SUPABASE_STUBS = `
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public, auth to anon, authenticated, service_role;
`;

export async function createDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
    } catch (e) {
      throw new Error(`migration ${f} failed: ${(e as Error).message}`);
    }
  }
  return db;
}

export async function addUser(db: PGlite, email: string, role: "subscriber" | "admin" = "subscriber"): Promise<string> {
  const r = await db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email]);
  const id = r.rows[0].id;
  if (role === "admin") await db.query(`update public.profiles set role = 'admin' where id = $1`, [id]);
  return id;
}

/** Run fn as an end-user (RLS applies) inside a transaction-less session, then reset. */
export async function asUser<T>(db: PGlite, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${userId ? "authenticated" : "anon"}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""]);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

export async function asService<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role service_role`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role`);
  }
}

export async function rejects(p: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await p;
  } catch (e) {
    const msg = (e as Error).message;
    if (!pattern.test(msg)) throw new Error(`expected error matching ${pattern}, got: ${msg}`);
    return;
  }
  throw new Error(`expected rejection matching ${pattern}, but it succeeded`);
}
