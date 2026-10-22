-- =============================================================================
-- Digital Heroes :: core schema (profiles, charities, subscriptions, scores)
-- All money is stored as integer minor units (paise). No floats, no numeric(â€¦,2).
-- Writes to sensitive tables happen ONLY through SECURITY DEFINER functions
-- (see 0003/0004) or the server's service-role client; clients get RLS-limited reads.
-- =============================================================================

create type public.user_role as enum ('subscriber', 'admin');
create type public.account_status as enum ('active', 'suspended');
create type public.subscription_status as enum
  ('incomplete', 'active', 'canceling', 'past_due', 'lapsed', 'canceled');
create type public.plan_interval as enum ('month', 'year');
create type public.charity_status as enum ('active', 'inactive', 'archived');

-- ---------------------------------------------------------------- helpers ----
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- True when the statement runs as an end-user role (PostgREST sets the role to
-- 'authenticated' / 'anon'). Privileged paths (service_role, postgres, definer
-- functions owned by postgres) are not end-user contexts.
create or replace function public.is_end_user_role() returns boolean
language sql stable as $$
  select current_user in ('authenticated', 'anon')
$$;

-- ---------------------------------------------------------------- profiles ---
create table public.profiles (
  id                      uuid primary key references auth.users (id) on delete cascade,
  email                   text not null,
  display_name            text,
  role                    public.user_role not null default 'subscriber',
  status                  public.account_status not null default 'active',
  terms_accepted_at       timestamptz,
  terms_version           text,
  onboarding_completed_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint display_name_len check (display_name is null or char_length(display_name) between 1 and 80)
);
create unique index profiles_email_key on public.profiles (lower(email));
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Clients may edit their display name / accept terms, never their role, status or email.
create or replace function public.guard_profile_update() returns trigger
language plpgsql as $$
begin
  if public.is_end_user_role() and (
       new.role is distinct from old.role
    or new.status is distinct from old.status
    or new.email is distinct from old.email
    or new.id is distinct from old.id) then
    raise exception 'FORBIDDEN: role, status and email cannot be changed by the account holder'
      using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- A profile row is created for every new auth user. Role is ALWAYS 'subscriber' here:
-- there is no signup path that can create an administrator.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, nullif(left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80), ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.status = 'active')
$$;

-- Internal assertion used by admin functions that receive an explicit actor id
-- (the service-role server passes the verified session user).
create or replace function public.assert_admin(p_actor uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_actor is null or not exists (
       select 1 from public.profiles
       where id = p_actor and role = 'admin' and status = 'active') then
    raise exception 'FORBIDDEN: administrator access required' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------- settings ---
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  is_public   boolean not null default false,
  description text,
  updated_by  uuid references public.profiles (id),
  updated_at  timestamptz not null default now()
);

-- Defaults. prize_pool_bps is a CONFIGURABLE ASSUMPTION, not a mandated figure:
-- the PRD says "a fixed portion of each subscription" without a number. The admin
-- must confirm it (prize_pool_confirmed) in Settings before real launch.
insert into public.app_settings (key, value, is_public, description) values
  ('prize_pool_bps',        '5000'::jsonb, true,  'Share of each recognised subscription payment that funds the prize pool, in basis points (5000 = 50%). ASSUMPTION: confirm before launch.'),
  ('prize_pool_confirmed',  'false'::jsonb, false, 'Set true once an administrator has confirmed prize_pool_bps.'),
  ('min_charity_bps',       '1000'::jsonb, true,  'Minimum charity contribution per PRD section 08.1 (10%).'),
  ('tier_config',           '{"shareBps":{"5":4000,"4":3500,"3":2500},"rollover":{"5":true,"4":false,"3":false},"unclaimedPolicy":"reserve"}'::jsonb, true, 'Prize tier shares (basis points, must total 10000), rollover flags and unclaimed-tier policy.'),
  ('currency',              '"inr"'::jsonb, true, 'ISO currency for all amounts (minor units = paise).');

-- ------------------------------------------------------------------- plans ---
create table public.plans (
  id              text primary key check (id in ('monthly', 'yearly')),
  name            text not null,
  interval        public.plan_interval not null,
  amount_minor    bigint not null check (amount_minor > 0),
  stripe_price_id text,
  is_active       boolean not null default true,
  updated_at      timestamptz not null default now()
);
-- Demo prices (INR). Yearly = 10 x monthly (two months free ~ 16.7% discount). Adjust in Settings.
insert into public.plans (id, name, interval, amount_minor) values
  ('monthly', 'Monthly', 'month', 99900),
  ('yearly',  'Yearly',  'year', 999000);

-- ---------------------------------------------------------------- charities --
create table public.charities (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  name              text not null check (char_length(name) between 2 and 120),
  short_description text,
  description       text,
  category          text,
  location          text,
  image_url         text,
  image_alt         text,
  website_url       text,
  is_featured       boolean not null default false,
  is_demo           boolean not null default false,
  status            public.charity_status not null default 'active',
  created_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index charities_status_idx on public.charities (status, is_featured);
create trigger charities_touch before update on public.charities
  for each row execute function public.touch_updated_at();

create table public.charity_events (
  id          uuid primary key default gen_random_uuid(),
  charity_id  uuid not null references public.charities (id) on delete cascade,
  title       text not null,
  description text,
  location    text,
  starts_at   timestamptz not null,
  status      text not null default 'published' check (status in ('draft', 'published', 'cancelled')),
  created_at  timestamptz not null default now()
);
create index charity_events_charity_idx on public.charity_events (charity_id, starts_at);

-- History-preserving. A change takes effect for money RECOGNISED after effective_from;
-- previously recognised contributions keep the charity they were booked against.
create table public.charity_selections (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  charity_id    uuid not null references public.charities (id),
  contribution_bps integer not null check (contribution_bps between 1000 and 10000),
  effective_from timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index charity_selections_user_idx on public.charity_selections (user_id, effective_from desc);

create or replace function public.current_selection(p_user uuid, p_at timestamptz default now())
returns public.charity_selections
language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.charity_selections
  where user_id = p_user and effective_from <= p_at
  order by effective_from desc, created_at desc
  limit 1
$$;

-- ------------------------------------------------------------ subscriptions --
create table public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null unique references public.profiles (id) on delete cascade,
  plan_id                text not null references public.plans (id),
  status                 public.subscription_status not null default 'incomplete',
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  last_event_created     bigint,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- Status history so eligibility can be evaluated AT A PAST CUTOFF, not "as of now".
create table public.subscription_history (
  id              bigint generated always as identity primary key,
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  user_id         uuid not null,
  status          public.subscription_status not null,
  effective_from  timestamptz not null default now(),
  effective_until timestamptz,
  paid_until      timestamptz
);
create index subscription_history_user_idx on public.subscription_history (user_id, effective_from);

create or replace function public.track_subscription_history() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT'
     or new.status is distinct from old.status
     or new.current_period_end is distinct from old.current_period_end then
    if tg_op = 'UPDATE' then
      update public.subscription_history
         set effective_until = now()
       where subscription_id = new.id and effective_until is null;
    end if;
    insert into public.subscription_history (subscription_id, user_id, status, effective_from, paid_until)
    values (new.id, new.user_id, new.status, now(), new.current_period_end);
  end if;
  return new;
end $$;
create trigger subscriptions_history after insert or update on public.subscriptions
  for each row execute function public.track_subscription_history();

-- ------------------------------------------------------------------- scores ---
create table public.scores (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  score_date date not null,
  value      smallint not null check (value between 1 and 45),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scores_one_per_date unique (user_id, score_date)
);
create index scores_user_date_idx on public.scores (user_id, score_date desc);
create trigger scores_touch before update on public.scores
  for each row execute function public.touch_updated_at();

-- Defence in depth: even a privileged writer cannot push a user above five scores.
create or replace function public.guard_score_cap() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.scores where user_id = new.user_id) >= 5 then
    raise exception 'SCORE_CAP: a user can hold at most five scores' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger scores_cap before insert on public.scores
  for each row execute function public.guard_score_cap();
-- =============================================================================
-- Draws, frozen snapshots, results, winnings, payouts, ledgers, audit.
-- Immutability is enforced by triggers, not by UI state.
-- =============================================================================

create type public.draw_status as enum ('draft', 'simulated', 'approved', 'published', 'cancelled');
create type public.draw_mode as enum ('random', 'weighted');
create type public.claim_status as enum
  ('not_submitted', 'pending_review', 'rejected', 'approved', 'payout_pending', 'paid');
create type public.review_status as enum ('pending', 'approved', 'rejected');

-- ------------------------------------------------------------------- draws ---
create table public.draws (
  id                     uuid primary key default gen_random_uuid(),
  title                  text not null check (char_length(title) between 3 and 120),
  period_month           date not null check (extract(day from period_month) = 1),
  status                 public.draw_status not null default 'draft',
  mode                   public.draw_mode not null default 'random',
  weight_bias            text not null default 'frequent' check (weight_bias in ('frequent', 'rare')),
  weight_smoothing       integer not null default 1 check (weight_smoothing >= 0),
  eligibility_cutoff     timestamptz not null,
  tier_config            jsonb not null,
  -- frozen at approval
  pool_minor             bigint check (pool_minor >= 0),
  jackpot_carry_in_minor bigint check (jackpot_carry_in_minor >= 0),
  snapshot_hash          text,
  participant_count      integer check (participant_count >= 0),
  approved_at            timestamptz,
  approved_by            uuid references public.profiles (id),
  -- filled at publication
  winning_numbers        smallint[],
  weights                jsonb,
  random_source          text,
  result_hash            text,
  published_at           timestamptz,
  published_by           uuid references public.profiles (id),
  notes                  text,
  created_by             uuid references public.profiles (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint published_has_result check (
    status <> 'published' or (
      winning_numbers is not null and array_length(winning_numbers, 1) = 5
      and result_hash is not null and published_at is not null)),
  constraint approved_has_freeze check (
    status not in ('approved', 'published') or (
      pool_minor is not null and jackpot_carry_in_minor is not null
      and snapshot_hash is not null and participant_count is not null))
);
-- One draw per calendar month (a cancelled draw may be replaced).
create unique index draws_one_per_month on public.draws (period_month) where status <> 'cancelled';
-- Only ONE draw can be approved-but-unpublished at a time. This serialises access to the
-- jackpot balance and the unallocated prize pool so two draws can never spend the same money.
create unique index draws_single_inflight on public.draws ((true)) where status = 'approved';
create trigger draws_touch before update on public.draws
  for each row execute function public.touch_updated_at();

-- Block edits to a published/cancelled draw, and edits to frozen columns once approved.
create or replace function public.guard_draw_update() returns trigger
language plpgsql as $$
begin
  if old.status in ('published', 'cancelled') then
    -- notes are the only thing that may change after the fact (corrections go through an audited procedure)
    if to_jsonb(new) - 'notes' - 'updated_at' is distinct from to_jsonb(old) - 'notes' - 'updated_at' then
      raise exception 'IMMUTABLE: a % draw cannot be modified', old.status using errcode = 'P0001';
    end if;
  elsif old.status = 'approved' and new.status = 'approved' then
    if new.mode is distinct from old.mode or new.weight_bias is distinct from old.weight_bias
       or new.weight_smoothing is distinct from old.weight_smoothing
       or new.eligibility_cutoff is distinct from old.eligibility_cutoff
       or new.tier_config is distinct from old.tier_config
       or new.pool_minor is distinct from old.pool_minor
       or new.jackpot_carry_in_minor is distinct from old.jackpot_carry_in_minor
       or new.snapshot_hash is distinct from old.snapshot_hash then
      raise exception 'IMMUTABLE: configuration of an approved draw is frozen' using errcode = 'P0001';
    end if;
  end if;
  -- legal status transitions (mirrors src/lib/draw-engine/state.ts)
  if new.status is distinct from old.status and not (
       (old.status = 'draft'     and new.status in ('simulated', 'cancelled'))
    or (old.status = 'simulated' and new.status in ('simulated', 'draft', 'approved', 'cancelled'))
    or (old.status = 'approved'  and new.status in ('simulated', 'published', 'cancelled'))) then
    raise exception 'TRANSITION: draw cannot move from % to %', old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger draws_guard before update on public.draws
  for each row execute function public.guard_draw_update();

create or replace function public.block_draw_delete() returns trigger
language plpgsql as $$
begin
  if old.status <> 'draft' then
    raise exception 'IMMUTABLE: only draft draws can be deleted' using errcode = 'P0001';
  end if;
  return old;
end $$;
create trigger draws_no_delete before delete on public.draws
  for each row execute function public.block_draw_delete();

-- Simulations are informational. They never touch ledgers, payouts or draw status by themselves.
create table public.draw_simulations (
  id              uuid primary key default gen_random_uuid(),
  draw_id         uuid not null references public.draws (id) on delete cascade,
  mode            public.draw_mode not null,
  random_source   text not null,
  winning_numbers smallint[] not null,
  summary         jsonb not null,
  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now()
);
create index draw_simulations_draw_idx on public.draw_simulations (draw_id, created_at desc);

-- --------------------------------------------------- frozen snapshot tables ---
create table public.draw_participants (
  draw_id    uuid not null references public.draws (id),
  user_id    uuid not null references public.profiles (id),
  frozen_at  timestamptz not null default now(),
  primary key (draw_id, user_id)
);
create table public.draw_score_snapshots (
  draw_id    uuid not null references public.draws (id),
  user_id    uuid not null,
  position   smallint not null check (position between 1 and 5),
  score_date date not null,
  value      smallint not null check (value between 1 and 45),
  primary key (draw_id, user_id, position),
  foreign key (draw_id, user_id) references public.draw_participants (draw_id, user_id)
);

-- Snapshot rows are written/removed only by approve_draw / unapprove_draw, which set a
-- transaction-local flag. Anyone else (including direct service-role SQL) is refused, and
-- nothing at all may change once the draw is published.
create or replace function public.guard_snapshot_write() returns trigger
language plpgsql as $$
declare
  v_draw uuid := coalesce(new.draw_id, old.draw_id);
  v_status public.draw_status;
begin
  select status into v_status from public.draws where id = v_draw;
  if v_status = 'published' then
    raise exception 'IMMUTABLE: snapshot of a published draw cannot change' using errcode = 'P0001';
  end if;
  if coalesce(current_setting('app.snapshot_write', true), '') <> 'on' then
    raise exception 'IMMUTABLE: snapshots are written only by approve_draw/unapprove_draw' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger participants_guard before insert or update or delete on public.draw_participants
  for each row execute function public.guard_snapshot_write();
create trigger snapshots_guard before insert or update or delete on public.draw_score_snapshots
  for each row execute function public.guard_snapshot_write();

-- ----------------------------------------------------------------- results ---
create table public.draw_matches (
  draw_id     uuid not null references public.draws (id),
  user_id     uuid not null references public.profiles (id),
  match_count smallint not null check (match_count between 0 and 5),
  tier        smallint check (tier in (3, 4, 5)),
  primary key (draw_id, user_id),
  constraint tier_matches_count check (tier is null or tier = match_count)
);
create table public.prize_allocations (
  draw_id          uuid not null references public.draws (id),
  tier             smallint not null check (tier in (3, 4, 5)),
  allocation_minor bigint not null check (allocation_minor >= 0),
  carry_in_minor   bigint not null check (carry_in_minor >= 0),
  fund_minor       bigint not null check (fund_minor >= 0),
  winner_count     integer not null check (winner_count >= 0),
  paid_minor       bigint not null check (paid_minor >= 0),
  unclaimed_minor  bigint not null check (unclaimed_minor >= 0),
  primary key (draw_id, tier),
  constraint fund_conserved check (fund_minor = allocation_minor + carry_in_minor),
  constraint fund_split check (paid_minor + unclaimed_minor = fund_minor)
);
create table public.draw_ledger_entries (
  draw_id      uuid not null references public.draws (id),
  seq          integer not null,
  from_account text not null,
  to_account   text not null,
  amount_minor bigint not null check (amount_minor > 0),
  kind         text not null,
  ref          text,
  primary key (draw_id, seq)
);

create table public.jackpot_ledger (
  id          bigint generated always as identity primary key,
  draw_id     uuid not null references public.draws (id),
  entry_type  text not null check (entry_type in ('carry_in_consumed', 'rollover_created')),
  delta_minor bigint not null,
  created_at  timestamptz not null default now(),
  unique (draw_id, entry_type)
);

-- Append-only guard shared by result/ledger/audit tables.
create or replace function public.block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'IMMUTABLE: % rows are append-only', tg_table_name using errcode = 'P0001';
end $$;
create trigger draw_matches_ro before update or delete on public.draw_matches
  for each row execute function public.block_mutation();
create trigger prize_allocations_ro before update or delete on public.prize_allocations
  for each row execute function public.block_mutation();
create trigger draw_ledger_ro before update or delete on public.draw_ledger_entries
  for each row execute function public.block_mutation();
create trigger jackpot_ledger_ro before update or delete on public.jackpot_ledger
  for each row execute function public.block_mutation();

-- ---------------------------------------------------------------- winnings ---
create table public.winnings (
  id            uuid primary key default gen_random_uuid(),
  draw_id       uuid not null references public.draws (id),
  user_id       uuid not null references public.profiles (id),
  tier          smallint not null check (tier in (3, 4, 5)),
  amount_minor  bigint not null check (amount_minor > 0),
  claim_status  public.claim_status not null default 'not_submitted',
  rejection_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (draw_id, user_id)
);
create index winnings_user_idx on public.winnings (user_id, created_at desc);
create index winnings_status_idx on public.winnings (claim_status);
create trigger winnings_touch before update on public.winnings
  for each row execute function public.touch_updated_at();

-- The amount, tier, user and draw of a winning are immutable; claim_status may only follow legal edges.
create or replace function public.guard_winning_update() returns trigger
language plpgsql as $$
begin
  if new.draw_id <> old.draw_id or new.user_id <> old.user_id
     or new.tier <> old.tier or new.amount_minor <> old.amount_minor then
    raise exception 'IMMUTABLE: a winning''s draw, user, tier and amount cannot change' using errcode = 'P0001';
  end if;
  if new.claim_status is distinct from old.claim_status and not (
       (old.claim_status = 'not_submitted'  and new.claim_status = 'pending_review')
    or (old.claim_status = 'pending_review' and new.claim_status in ('approved', 'rejected'))
    or (old.claim_status = 'rejected'       and new.claim_status = 'pending_review')
    or (old.claim_status = 'approved'       and new.claim_status = 'payout_pending')
    or (old.claim_status = 'payout_pending' and new.claim_status = 'paid')) then
    raise exception 'TRANSITION: winning cannot move from % to %', old.claim_status, new.claim_status
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger winnings_guard before update on public.winnings
  for each row execute function public.guard_winning_update();
create trigger winnings_no_delete before delete on public.winnings
  for each row execute function public.block_mutation();

create table public.winner_evidence (
  id               uuid primary key default gen_random_uuid(),
  winning_id       uuid not null references public.winnings (id),
  user_id          uuid not null references public.profiles (id),
  storage_path     text not null check (storage_path !~ '\.\.'),
  mime_type        text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes       integer not null check (size_bytes between 1 and 5242880),
  review_status    public.review_status not null default 'pending',
  reviewed_by      uuid references public.profiles (id),
  reviewed_at      timestamptz,
  rejection_reason text,
  submitted_at     timestamptz not null default now(),
  check (storage_path like user_id::text || '/%'),
  check (review_status <> 'rejected' or rejection_reason is not null)
);
create index winner_evidence_winning_idx on public.winner_evidence (winning_id, submitted_at desc);
create index winner_evidence_queue_idx on public.winner_evidence (review_status, submitted_at);

create table public.payouts (
  id          uuid primary key default gen_random_uuid(),
  winning_id  uuid not null unique references public.winnings (id),
  amount_minor bigint not null check (amount_minor > 0),
  status      text not null default 'pending' check (status in ('pending', 'paid')),
  reference   text unique,                 -- idempotency key: external transfer reference (e.g. bank UTR)
  method      text,
  notes       text,
  queued_at   timestamptz not null default now(),
  paid_at     timestamptz,
  paid_by     uuid references public.profiles (id),
  check (status <> 'paid' or (reference is not null and paid_at is not null))
);

-- ----------------------------------------------------------- finance ledger ---
create table public.contributions (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('subscription_monthly', 'subscription_annual_installment', 'donation')),
  user_id        uuid not null references public.profiles (id),
  subscription_id uuid references public.subscriptions (id),
  charity_id     uuid references public.charities (id),
  invoice_id     text,
  amount_minor   bigint not null check (amount_minor > 0),
  charity_minor  bigint not null check (charity_minor >= 0),
  pool_minor     bigint not null check (pool_minor >= 0),
  platform_minor bigint not null check (platform_minor >= 0),
  charity_bps    integer not null check (charity_bps between 0 and 10000),
  pool_bps       integer not null check (pool_bps between 0 and 10000),
  draw_id        uuid references public.draws (id),   -- draw whose prize pool consumed pool_minor
  idempotency_key text not null unique,
  recognized_at  timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  constraint contribution_conserved check (charity_minor + pool_minor + platform_minor = amount_minor),
  constraint charity_floor check (
    kind = 'donation' or charity_minor >= (amount_minor * 1000) / 10000)
);
create index contributions_user_idx on public.contributions (user_id, recognized_at desc);
create index contributions_pool_idx on public.contributions (draw_id) where pool_minor > 0;
create index contributions_charity_idx on public.contributions (charity_id);

create table public.recognition_schedule (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    text not null,
  subscription_id uuid not null references public.subscriptions (id),
  user_id       uuid not null references public.profiles (id),
  installment   smallint not null check (installment between 1 and 12),
  due_on        date not null,
  amount_minor  bigint not null check (amount_minor >= 0),
  recognized_at timestamptz,
  unique (invoice_id, installment)
);
create index recognition_due_idx on public.recognition_schedule (due_on) where recognized_at is null;

create table public.ledger_groups (
  id              uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  kind            text not null,
  description     text,
  occurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create table public.financial_ledger (
  id           bigint generated always as identity primary key,
  group_id     uuid not null references public.ledger_groups (id),
  account      text not null check (account in (
    'cash', 'deferred_revenue', 'charity_payable', 'prize_pool', 'platform_revenue',
    'prize_payable', 'jackpot_carry', 'reserve_unclaimed')),
  direction    text not null check (direction in ('debit', 'credit')),
  amount_minor bigint not null check (amount_minor > 0),
  currency     text not null default 'inr',
  ref_type     text,
  ref_id       text,
  created_at   timestamptz not null default now()
);
create index financial_ledger_group_idx on public.financial_ledger (group_id);
create index financial_ledger_account_idx on public.financial_ledger (account, created_at);
create trigger financial_ledger_ro before update or delete on public.financial_ledger
  for each row execute function public.block_mutation();
create trigger ledger_groups_ro before update or delete on public.ledger_groups
  for each row execute function public.block_mutation();

-- Every ledger group must balance (debits = credits) by the end of the transaction.
create or replace function public.check_ledger_group_balanced() returns trigger
language plpgsql as $$
declare v_debit bigint; v_credit bigint;
begin
  select coalesce(sum(amount_minor) filter (where direction = 'debit'), 0),
         coalesce(sum(amount_minor) filter (where direction = 'credit'), 0)
    into v_debit, v_credit
    from public.financial_ledger where group_id = new.group_id;
  if v_debit <> v_credit then
    raise exception 'LEDGER: group % is unbalanced (debit %, credit %)', new.group_id, v_debit, v_credit
      using errcode = 'P0001';
  end if;
  return null;
end $$;
create constraint trigger financial_ledger_balanced after insert on public.financial_ledger
  deferrable initially deferred for each row execute function public.check_ledger_group_balanced();

-- ------------------------------------------------- notifications / audit ------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text,
  ref        jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  actor_role  text,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  before_data jsonb,
  after_data  jsonb,
  reason      text,
  created_at  timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create trigger audit_logs_ro before update or delete on public.audit_logs
  for each row execute function public.block_mutation();

create table public.webhook_events (
  stripe_event_id text primary key,
  type            text not null,
  created         bigint not null,
  status          text not null default 'claimed' check (status in ('claimed', 'processed', 'failed')),
  error           text,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz
);

create or replace function public.write_audit(
  p_actor uuid, p_action text, p_entity_type text, p_entity_id text,
  p_before jsonb default null, p_after jsonb default null, p_reason text default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, before_data, after_data, reason)
  values (p_actor, (select role::text from public.profiles where id = p_actor),
          p_action, p_entity_type, p_entity_id, p_before, p_after, p_reason)
$$;
-- =============================================================================
-- Business functions. These are the AUTHORITATIVE implementations of:
--   * rolling-five score rule (row lock + unique date + cap trigger)
--   * eligibility snapshot, draw approval and atomic publication
--   * evidence review / payout transitions
--   * payment posting (idempotent, integer arithmetic, double-entry)
-- The TypeScript modules in src/lib mirror these rules for unit testing and previews;
-- tests/db-*.test.ts proves parity against a real Postgres (PGlite).
-- Error convention: RAISE EXCEPTION 'CODE: human message' (errcode P0001 unless noted).
-- =============================================================================

-- ------------------------------------------------------------------ scores ----
-- "Not in the future anywhere on Earth": UTC+14 is the furthest-ahead timezone.
create or replace function public.max_score_date() returns date
language sql stable as $$ select ((now() at time zone 'UTC') + interval '14 hours')::date $$;

create or replace function public._add_score(p_user uuid, p_date date, p_value integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count   integer;
  v_oldest  public.scores;
  v_evicted public.scores;
  v_new     public.scores;
begin
  if p_value is null or p_value < 1 or p_value > 45 then
    raise exception 'INVALID_VALUE: Enter a whole number between 1 and 45.' using errcode = 'P0001';
  end if;
  if p_date is null then
    raise exception 'INVALID_DATE: Enter a valid date.' using errcode = 'P0001';
  end if;
  if p_date > public.max_score_date() then
    raise exception 'FUTURE_DATE: Scores can''t be dated in the future.' using errcode = 'P0001';
  end if;

  -- Serialise every score write for this user. Two concurrent inserts queue here, so the
  -- count/evict/insert sequence below can never interleave.
  perform 1 from public.profiles where id = p_user for update;
  if not found then
    raise exception 'NOT_FOUND: account not found.' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.scores where user_id = p_user and score_date = p_date) then
    raise exception 'DUPLICATE_DATE: You already have a score for that date. Edit or delete it instead.'
      using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.scores where user_id = p_user;
  if v_count >= 5 then
    select * into v_oldest from public.scores
     where user_id = p_user order by score_date asc, id desc limit 1;
    if p_date < v_oldest.score_date then
      raise exception 'OLDER_THAN_WINDOW: That round is older than your five most recent scores, so it can''t be added.'
        using errcode = 'P0001';
    end if;
    delete from public.scores where id = v_oldest.id returning * into v_evicted;
  end if;

  insert into public.scores (user_id, score_date, value)
  values (p_user, p_date, p_value) returning * into v_new;

  return jsonb_build_object('score', to_jsonb(v_new), 'evicted', to_jsonb(v_evicted));
end $$;

create or replace function public._update_score(p_user uuid, p_id uuid, p_date date, p_value integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.scores;
begin
  if p_value is null or p_value < 1 or p_value > 45 then
    raise exception 'INVALID_VALUE: Enter a whole number between 1 and 45.' using errcode = 'P0001';
  end if;
  if p_date is null then
    raise exception 'INVALID_DATE: Enter a valid date.' using errcode = 'P0001';
  end if;
  if p_date > public.max_score_date() then
    raise exception 'FUTURE_DATE: Scores can''t be dated in the future.' using errcode = 'P0001';
  end if;
  perform 1 from public.profiles where id = p_user for update;
  -- Not found OR someone else's: same message, so ids cannot be probed.
  if not exists (select 1 from public.scores where id = p_id and user_id = p_user) then
    raise exception 'NOT_FOUND: Score not found.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.scores where user_id = p_user and score_date = p_date and id <> p_id) then
    raise exception 'DUPLICATE_DATE: You already have a score for that date.' using errcode = 'P0001';
  end if;
  update public.scores set score_date = p_date, value = p_value
   where id = p_id and user_id = p_user returning * into v_row;
  return to_jsonb(v_row);
end $$;

create or replace function public._delete_score(p_user uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.scores;
begin
  perform 1 from public.profiles where id = p_user for update;
  delete from public.scores where id = p_id and user_id = p_user returning * into v_row;
  if not found then
    raise exception 'NOT_FOUND: Score not found.' using errcode = 'P0001';
  end if;
  return to_jsonb(v_row);
end $$;

-- Client-callable wrappers: the actor is ALWAYS the authenticated user, never a parameter.
create or replace function public.add_score(p_date date, p_value integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  return public._add_score(auth.uid(), p_date, p_value);
end $$;
create or replace function public.update_score(p_id uuid, p_date date, p_value integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  return public._update_score(auth.uid(), p_id, p_date, p_value);
end $$;
create or replace function public.delete_score(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  return public._delete_score(auth.uid(), p_id);
end $$;

-- ------------------------------------------------------------------ charity ---
create or replace function public.select_charity(p_charity uuid, p_bps integer) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_min integer := coalesce((select (value #>> '{}')::integer from public.app_settings where key = 'min_charity_bps'), 1000);
  v_id  uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_bps is null or p_bps < v_min or p_bps > 10000 then
    raise exception 'INVALID_PERCENTAGE: Contribution must be between % and 100 percent.', v_min / 100
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.charities where id = p_charity and status = 'active') then
    raise exception 'NOT_FOUND: That charity isn''t available.' using errcode = 'P0001';
  end if;
  insert into public.charity_selections (user_id, charity_id, contribution_bps)
  values (auth.uid(), p_charity, p_bps) returning id into v_id;
  return v_id;
end $$;

-- -------------------------------------------------------- money primitives ----
create or replace function public.split_payment_sql(p_amount bigint, p_charity_bps integer, p_pool_bps integer)
returns table (charity_minor bigint, pool_minor bigint, platform_minor bigint)
language plpgsql immutable as $$
declare v_c bigint; v_p bigint;
begin
  if p_amount is null or p_amount < 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  if p_charity_bps < 0 or p_pool_bps < 0 or p_charity_bps + p_pool_bps > 10000 then
    raise exception 'INVALID_SPLIT: shares exceed 100%%' using errcode = 'P0001';
  end if;
  v_c := (p_amount * p_charity_bps) / 10000;  -- bigint division truncates = floor for non-negative values
  v_p := (p_amount * p_pool_bps) / 10000;
  return query select v_c, v_p, p_amount - v_c - v_p;
end $$;

create or replace function public._setting_int(p_key text, p_default integer) returns integer
language sql stable as $$
  select coalesce((select (value #>> '{}')::integer from public.app_settings where key = p_key), p_default)
$$;

create or replace function public._post_split(
  p_group uuid, p_user uuid, p_subscription uuid, p_invoice text, p_kind text, p_amount bigint,
  p_idem text, p_debit_account text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sel   public.charity_selections;
  v_min   integer := public._setting_int('min_charity_bps', 1000);
  v_pool  integer := public._setting_int('prize_pool_bps', 5000);
  v_cbps  integer;
  v_c bigint; v_p bigint; v_f bigint;
begin
  select * into v_sel from public.current_selection(p_user, now());
  v_cbps := greatest(coalesce(v_sel.contribution_bps, v_min), v_min);
  select s.charity_minor, s.pool_minor, s.platform_minor into v_c, v_p, v_f
    from public.split_payment_sql(p_amount, v_cbps, v_pool) s;

  insert into public.contributions
    (kind, user_id, subscription_id, charity_id, invoice_id, amount_minor, charity_minor, pool_minor,
     platform_minor, charity_bps, pool_bps, idempotency_key)
  values (p_kind, p_user, p_subscription, v_sel.charity_id, p_invoice, p_amount, v_c, v_p, v_f,
          v_cbps, v_pool, p_idem);

  insert into public.financial_ledger (group_id, account, direction, amount_minor, ref_type, ref_id) values
    (p_group, p_debit_account, 'debit', p_amount, 'invoice', p_invoice);
  if v_c > 0 then insert into public.financial_ledger (group_id, account, direction, amount_minor, ref_type, ref_id)
    values (p_group, 'charity_payable', 'credit', v_c, 'invoice', p_invoice); end if;
  if v_p > 0 then insert into public.financial_ledger (group_id, account, direction, amount_minor, ref_type, ref_id)
    values (p_group, 'prize_pool', 'credit', v_p, 'invoice', p_invoice); end if;
  if v_f > 0 then insert into public.financial_ledger (group_id, account, direction, amount_minor, ref_type, ref_id)
    values (p_group, 'platform_revenue', 'credit', v_f, 'invoice', p_invoice); end if;
end $$;

-- ------------------------------------------------------------ payment posting -
create or replace function public.post_monthly_payment(
  p_invoice text, p_subscription uuid, p_amount bigint, p_paid_at timestamptz)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_group uuid; v_user uuid;
begin
  select user_id into v_user from public.subscriptions where id = p_subscription;
  if v_user is null then raise exception 'NOT_FOUND: subscription' using errcode = 'P0001'; end if;
  insert into public.ledger_groups (idempotency_key, kind, description, occurred_at)
  values ('invoice:' || p_invoice, 'subscription_payment_monthly', 'Monthly subscription payment', coalesce(p_paid_at, now()))
  on conflict (idempotency_key) do nothing returning id into v_group;
  if v_group is null then return false; end if;       -- replay: money already posted
  perform public._post_split(v_group, v_user, p_subscription, p_invoice, 'subscription_monthly',
                             p_amount, 'invoice:' || p_invoice || ':contribution', 'cash');
  return true;
end $$;

create or replace function public.post_annual_payment(
  p_invoice text, p_subscription uuid, p_amount bigint, p_paid_at timestamptz)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_group uuid; v_user uuid; i integer; v_base bigint; v_rem bigint; v_start date;
begin
  select user_id into v_user from public.subscriptions where id = p_subscription;
  if v_user is null then raise exception 'NOT_FOUND: subscription' using errcode = 'P0001'; end if;
  insert into public.ledger_groups (idempotency_key, kind, description, occurred_at)
  values ('invoice:' || p_invoice, 'subscription_payment_annual', 'Annual subscription payment (deferred)', coalesce(p_paid_at, now()))
  on conflict (idempotency_key) do nothing returning id into v_group;
  if v_group is null then return false; end if;

  -- POLICY: the whole annual payment is deferred revenue. Charity / prize-pool / platform
  -- portions are recognised monthly (see recognize_due_installments), never at payment time,
  -- so the same money cannot be counted twice.
  insert into public.financial_ledger (group_id, account, direction, amount_minor, ref_type, ref_id) values
    (v_group, 'cash', 'debit', p_amount, 'invoice', p_invoice),
    (v_group, 'deferred_revenue', 'credit', p_amount, 'invoice', p_invoice);

  v_base := p_amount / 12; v_rem := p_amount - v_base * 12;
  v_start := (coalesce(p_paid_at, now()) at time zone 'UTC')::date;
  for i in 1..12 loop
    insert into public.recognition_schedule (invoice_id, subscription_id, user_id, installment, due_on, amount_minor)
    values (p_invoice, p_subscription, v_user, i, v_start + ((i - 1) * interval '1 month')::interval,
            v_base + case when i <= v_rem then 1 else 0 end);
  end loop;
  perform public.recognize_due_installments(now());
  return true;
end $$;

create or replace function public.recognize_due_installments(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_group uuid; v_n integer := 0;
begin
  for r in
    select * from public.recognition_schedule
     where recognized_at is null and due_on <= (p_now at time zone 'UTC')::date
     order by due_on, installment for update skip locked
  loop
    if r.amount_minor > 0 then
      insert into public.ledger_groups (idempotency_key, kind, description, occurred_at)
      values ('recognize:' || r.invoice_id || ':' || r.installment, 'annual_recognition',
              'Annual instalment ' || r.installment || '/12 recognised', p_now)
      on conflict (idempotency_key) do nothing returning id into v_group;
      if v_group is not null then
        perform public._post_split(v_group, r.user_id, r.subscription_id, r.invoice_id,
          'subscription_annual_installment', r.amount_minor,
          'recognize:' || r.invoice_id || ':' || r.installment || ':contribution', 'deferred_revenue');
        v_n := v_n + 1;
      end if;
    end if;
    update public.recognition_schedule set recognized_at = p_now where id = r.id;
  end loop;
  return v_n;
end $$;

create or replace function public.post_donation(
  p_payment text, p_user uuid, p_charity uuid, p_amount bigint, p_paid_at timestamptz)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_group uuid;
begin
  if p_amount is null or p_amount < 1000 then raise exception 'INVALID_AMOUNT: minimum donation is 1000 minor units' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.charities where id = p_charity and status = 'active') then
    raise exception 'NOT_FOUND: charity' using errcode = 'P0001';
  end if;
  insert into public.ledger_groups (idempotency_key, kind, description, occurred_at)
  values ('donation:' || p_payment, 'donation', 'Independent donation', coalesce(p_paid_at, now()))
  on conflict (idempotency_key) do nothing returning id into v_group;
  if v_group is null then return false; end if;
  insert into public.contributions (kind, user_id, charity_id, invoice_id, amount_minor, charity_minor, pool_minor,
                                    platform_minor, charity_bps, pool_bps, idempotency_key)
  values ('donation', p_user, p_charity, p_payment, p_amount, p_amount, 0, 0, 10000, 0, 'donation:' || p_payment);
  insert into public.financial_ledger (group_id, account, direction, amount_minor, ref_type, ref_id) values
    (v_group, 'cash', 'debit', p_amount, 'donation', p_payment),
    (v_group, 'charity_payable', 'credit', p_amount, 'donation', p_payment);
  return true;
end $$;

-- -------------------------------------------------------- billing sync (Stripe)
create or replace function public.claim_webhook_event(p_id text, p_type text, p_created bigint) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rows integer;
begin
  -- First delivery claims the id. A redelivery is accepted again ONLY if the previous attempt
  -- failed, or crashed mid-flight (claimed > 5 minutes ago); processed events are never replayed.
  -- Re-processing is safe because every money posting is independently idempotent on its invoice id.
  insert into public.webhook_events (stripe_event_id, type, created) values (p_id, p_type, p_created)
  on conflict (stripe_event_id) do update
     set status = 'claimed', error = null, received_at = now()
   where public.webhook_events.status = 'failed'
      or (public.webhook_events.status = 'claimed' and public.webhook_events.received_at < now() - interval '5 minutes');
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

create or replace function public.finish_webhook_event(p_id text, p_status text, p_error text default null) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.webhook_events
     set status = p_status, error = p_error, processed_at = now()
   where stripe_event_id = p_id
$$;

create or replace function public.link_checkout(
  p_user uuid, p_customer text, p_stripe_sub text, p_plan text, p_charity uuid, p_bps integer)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_min integer := public._setting_int('min_charity_bps', 1000);
begin
  insert into public.subscriptions (user_id, plan_id, status, stripe_customer_id, stripe_subscription_id)
  values (p_user, p_plan, 'incomplete', p_customer, p_stripe_sub)
  on conflict (user_id) do update set
    plan_id = excluded.plan_id,
    stripe_customer_id = excluded.stripe_customer_id,
    last_event_created = case when public.subscriptions.stripe_subscription_id is distinct from excluded.stripe_subscription_id
                              then null else public.subscriptions.last_event_created end,
    status = case when public.subscriptions.stripe_subscription_id is distinct from excluded.stripe_subscription_id
                  then 'incomplete'::public.subscription_status else public.subscriptions.status end,
    stripe_subscription_id = excluded.stripe_subscription_id
  returning id into v_id;

  if p_charity is not null and p_bps is not null and p_bps >= v_min and p_bps <= 10000
     and exists (select 1 from public.charities where id = p_charity and status = 'active') then
    insert into public.charity_selections (user_id, charity_id, contribution_bps)
    select p_user, p_charity, p_bps
     where not exists (select 1 from public.current_selection(p_user) c
                       where c.charity_id = p_charity and c.contribution_bps = p_bps);
  end if;
  return v_id;
end $$;

create or replace function public.apply_subscription_state(
  p_sub uuid, p_status text, p_start timestamptz, p_end timestamptz, p_cancel boolean, p_event bigint)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.subscriptions set
    status = p_status::public.subscription_status,
    current_period_start = coalesce(p_start, current_period_start),
    current_period_end = coalesce(p_end, current_period_end),
    cancel_at_period_end = p_cancel,
    last_event_created = p_event
  where id = p_sub and (last_event_created is null or last_event_created <= p_event);
  return found;
end $$;

-- ------------------------------------------------------- eligibility / draws --
create or replace function public.compute_eligible_snapshot(p_cutoff timestamptz)
returns table (user_id uuid, pos integer, score_date date, value integer)
language sql stable security definer set search_path = public, pg_temp as $$
  with active_users as (
    select distinct h.user_id
      from public.subscription_history h
      join public.profiles pr on pr.id = h.user_id and pr.status = 'active'
     where h.status in ('active', 'canceling')
       and h.effective_from <= p_cutoff
       and (h.effective_until is null or h.effective_until > p_cutoff)
       and (h.paid_until is null or h.paid_until > p_cutoff)
  ), ranked as (
    select s.user_id, s.score_date, s.value,
           row_number() over (partition by s.user_id order by s.score_date desc, s.id) as rn
      from public.scores s
      join active_users a on a.user_id = s.user_id
     where s.score_date <= (p_cutoff at time zone 'UTC')::date
       and s.created_at <= p_cutoff
  ), eligible as (
    select r.user_id from ranked r where r.rn <= 5 group by r.user_id having count(*) = 5
  )
  select r.user_id, r.rn::integer, r.score_date, r.value::integer
    from ranked r join eligible e on e.user_id = r.user_id
   where r.rn <= 5
   order by r.user_id, r.rn
$$;

-- Canonical hash; byte-for-byte equal to hashSnapshot() in src/lib/draw-engine/run.ts.
create or replace function public.snapshot_hash_for(p_draw uuid) returns text
language sql stable set search_path = public, pg_temp as $$
  select encode(sha256(convert_to(coalesce(string_agg(t.line, E'\n' order by t.uid collate "C"), ''), 'UTF8')), 'hex')
    from (
      select s.user_id::text as uid,
             s.user_id::text || '|' ||
               string_agg(to_char(s.score_date, 'YYYY-MM-DD') || ':' || s.value::text, ',' order by s.position) as line
        from public.draw_score_snapshots s
       where s.draw_id = p_draw
       group by s.user_id
    ) t
$$;

create or replace function public.public_jackpot_balance() returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(delta_minor), 0)::bigint from public.jackpot_ledger
$$;

create or replace function public.unallocated_pool_minor(p_cutoff timestamptz) returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(pool_minor), 0)::bigint from public.contributions
   where draw_id is null and pool_minor > 0 and recognized_at <= p_cutoff
$$;

create or replace function public.record_simulation(
  p_draw uuid, p_actor uuid, p_numbers smallint[], p_source text, p_summary jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_draw public.draws; v_id uuid;
begin
  perform public.assert_admin(p_actor);
  select * into v_draw from public.draws where id = p_draw for update;
  if not found then raise exception 'NOT_FOUND: draw' using errcode = 'P0001'; end if;
  if v_draw.status not in ('draft', 'simulated') then
    raise exception 'TRANSITION: a % draw cannot be simulated', v_draw.status using errcode = 'P0001';
  end if;
  insert into public.draw_simulations (draw_id, mode, random_source, winning_numbers, summary, created_by)
  values (p_draw, v_draw.mode, p_source, p_numbers, p_summary, p_actor) returning id into v_id;
  update public.draws set status = 'simulated' where id = p_draw;
  perform public.write_audit(p_actor, 'draw.simulated', 'draw', p_draw::text, null,
                             jsonb_build_object('simulation_id', v_id, 'numbers', p_numbers), 'SIMULATION ONLY - no ledger impact');
  return v_id;
end $$;

create or replace function public.approve_draw(p_draw uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_draw public.draws; v_pool bigint; v_carry bigint; v_hash text; v_n integer;
begin
  perform public.assert_admin(p_actor);
  select * into v_draw from public.draws where id = p_draw for update;
  if not found then raise exception 'NOT_FOUND: draw' using errcode = 'P0001'; end if;
  if v_draw.status <> 'simulated' then
    raise exception 'TRANSITION: only a simulated draw can be approved (currently %)', v_draw.status using errcode = 'P0001';
  end if;
  if now() < v_draw.eligibility_cutoff then
    raise exception 'CUTOFF_NOT_REACHED: the eligibility cutoff (%) has not passed yet', v_draw.eligibility_cutoff using errcode = 'P0001';
  end if;
  if exists (select 1 from public.draws where status = 'approved' and id <> p_draw) then
    raise exception 'DRAW_IN_FLIGHT: another draw is already approved and awaiting publication' using errcode = 'P0001';
  end if;

  perform set_config('app.snapshot_write', 'on', true);
  insert into public.draw_participants (draw_id, user_id)
    select distinct p_draw, e.user_id from public.compute_eligible_snapshot(v_draw.eligibility_cutoff) e;
  insert into public.draw_score_snapshots (draw_id, user_id, position, score_date, value)
    select p_draw, e.user_id, e.pos, e.score_date, e.value
      from public.compute_eligible_snapshot(v_draw.eligibility_cutoff) e;
  perform set_config('app.snapshot_write', 'off', true);

  with claimed as (
    update public.contributions set draw_id = p_draw
     where draw_id is null and pool_minor > 0 and recognized_at <= v_draw.eligibility_cutoff
    returning pool_minor)
  select coalesce(sum(pool_minor), 0) into v_pool from claimed;
  select coalesce(sum(delta_minor), 0) into v_carry from public.jackpot_ledger;
  v_hash := public.snapshot_hash_for(p_draw);
  select count(*) into v_n from public.draw_participants where draw_id = p_draw;

  update public.draws set status = 'approved', pool_minor = v_pool, jackpot_carry_in_minor = v_carry,
         snapshot_hash = v_hash, participant_count = v_n, approved_at = now(), approved_by = p_actor
   where id = p_draw;

  perform public.write_audit(p_actor, 'draw.approved', 'draw', p_draw::text, null,
    jsonb_build_object('pool_minor', v_pool, 'jackpot_carry_in_minor', v_carry,
                       'participants', v_n, 'snapshot_hash', v_hash));
  return jsonb_build_object('pool_minor', v_pool, 'jackpot_carry_in_minor', v_carry,
                            'participant_count', v_n, 'snapshot_hash', v_hash);
end $$;

create or replace function public.unapprove_draw(p_draw uuid, p_actor uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_draw public.draws;
begin
  perform public.assert_admin(p_actor);
  if p_reason is null or char_length(trim(p_reason)) < 5 then
    raise exception 'REASON_REQUIRED: explain why the approval is being withdrawn' using errcode = 'P0001';
  end if;
  select * into v_draw from public.draws where id = p_draw for update;
  if not found then raise exception 'NOT_FOUND: draw' using errcode = 'P0001'; end if;
  if v_draw.status <> 'approved' then
    raise exception 'TRANSITION: only an approved (unpublished) draw can be un-approved' using errcode = 'P0001';
  end if;
  perform set_config('app.snapshot_write', 'on', true);
  delete from public.draw_score_snapshots where draw_id = p_draw;
  delete from public.draw_participants where draw_id = p_draw;
  perform set_config('app.snapshot_write', 'off', true);
  update public.contributions set draw_id = null where draw_id = p_draw;
  update public.draws set status = 'simulated', pool_minor = null, jackpot_carry_in_minor = null,
         snapshot_hash = null, participant_count = null, approved_at = null, approved_by = null
   where id = p_draw;
  perform public.write_audit(p_actor, 'draw.unapproved', 'draw', p_draw::text, null, null, p_reason);
end $$;

-- ---------------------------------------------------------------- publication -
-- ATOMIC and IDEMPOTENT. The row lock on the draw serialises concurrent publishers; the second
-- caller blocks, then sees status = 'published' and receives the stored result without writing.
-- The function does NOT trust the computed result: it re-derives every match count from the
-- frozen snapshot, re-checks tier funds and conservation, and refuses on any mismatch.
create or replace function public.publish_draw(p_draw uuid, p_actor uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_draw      public.draws;
  v_nums      smallint[];
  v_cfg       jsonb;
  v_pool      bigint; v_carry bigint;
  v_balance   bigint;
  v_n         integer;
  v_seq       integer := 0;
  v_paid      bigint := 0; v_out bigint := 0; v_res bigint := 0;
  v_alloc5    bigint; v_alloc4 bigint; v_alloc3 bigint; v_dust bigint;
  t           integer; a jsonb; m jsonb; p jsonb; e jsonb;
  v_expected  bigint; v_count integer; v_min bigint; v_max bigint; v_sum bigint;
  v_rolls     boolean; v_group uuid;
begin
  perform public.assert_admin(p_actor);
  select * into v_draw from public.draws where id = p_draw for update;
  if not found then raise exception 'NOT_FOUND: draw' using errcode = 'P0001'; end if;

  if v_draw.status = 'published' then
    return jsonb_build_object('status', 'already_published', 'draw_id', p_draw, 'result_hash', v_draw.result_hash);
  end if;
  if v_draw.status <> 'approved' then
    raise exception 'TRANSITION: only an approved draw can be published (currently %)', v_draw.status using errcode = 'P0001';
  end if;

  -- 1. snapshot integrity
  if public.snapshot_hash_for(p_draw) <> v_draw.snapshot_hash
     or coalesce(p_result ->> 'snapshotHash', '') <> v_draw.snapshot_hash then
    raise exception 'SNAPSHOT_MISMATCH: the frozen snapshot does not match the approved hash' using errcode = 'P0001';
  end if;
  v_pool := v_draw.pool_minor; v_carry := v_draw.jackpot_carry_in_minor;
  select coalesce(sum(delta_minor), 0) into v_balance from public.jackpot_ledger;
  if v_balance <> v_carry then
    raise exception 'JACKPOT_CHANGED: jackpot balance moved since approval; un-approve and re-approve' using errcode = 'P0001';
  end if;
  if (select coalesce(sum(pool_minor), 0) from public.contributions where draw_id = p_draw) <> v_pool then
    raise exception 'POOL_CHANGED: prize-pool contributions no longer match the approved pool' using errcode = 'P0001';
  end if;

  -- 2. winning numbers: five distinct integers in 1..45
  select array_agg(x::smallint order by x::smallint) into v_nums
    from jsonb_array_elements_text(p_result -> 'winningNumbers') x;
  if v_nums is null or array_length(v_nums, 1) <> 5
     or (select count(distinct n) from unnest(v_nums) n) <> 5
     or exists (select 1 from unnest(v_nums) n where n < 1 or n > 45) then
    raise exception 'INVALID_NUMBERS: expected five distinct numbers between 1 and 45' using errcode = 'P0001';
  end if;

  -- 3. independently recompute every participant's match count from the frozen snapshot
  select count(*) into v_n from public.draw_participants where draw_id = p_draw;
  if jsonb_array_length(p_result -> 'matches') <> v_n then
    raise exception 'RESULT_MISMATCH: participant count differs from the snapshot' using errcode = 'P0001';
  end if;
  for m in select * from jsonb_array_elements(p_result -> 'matches') loop
    select count(distinct s.value) filter (where s.value = any (v_nums)) into v_count
      from public.draw_score_snapshots s
     where s.draw_id = p_draw and s.user_id = (m ->> 'userId')::uuid;
    if v_count is null or v_count <> (m ->> 'matches')::integer
       or (m ->> 'tier') is distinct from (case when v_count >= 3 then v_count::text end) then
      raise exception 'RESULT_MISMATCH: match count for % does not recompute', m ->> 'userId' using errcode = 'P0001';
    end if;
  end loop;

  -- 4. tier funds, equal split and conservation
  v_cfg := v_draw.tier_config;
  if (v_cfg #>> '{shareBps,5}')::bigint + (v_cfg #>> '{shareBps,4}')::bigint + (v_cfg #>> '{shareBps,3}')::bigint <> 10000 then
    raise exception 'INVALID_CONFIG: tier shares must total 10000 bps' using errcode = 'P0001';
  end if;
  v_alloc5 := (v_pool * (v_cfg #>> '{shareBps,5}')::bigint) / 10000;
  v_alloc4 := (v_pool * (v_cfg #>> '{shareBps,4}')::bigint) / 10000;
  v_alloc3 := (v_pool * (v_cfg #>> '{shareBps,3}')::bigint) / 10000;
  v_dust := v_pool - v_alloc5 - v_alloc4 - v_alloc3;
  v_alloc5 := v_alloc5 + v_dust;

  for a in select * from jsonb_array_elements(p_result -> 'allocations') loop
    t := (a ->> 'tier')::integer;
    v_expected := case t when 5 then v_alloc5 when 4 then v_alloc4 else v_alloc3 end;
    if (a ->> 'allocationMinor')::bigint <> v_expected
       or (a ->> 'carryInMinor')::bigint <> (case when t = 5 then v_carry else 0 end)
       or (a ->> 'fundMinor')::bigint <> v_expected + (case when t = 5 then v_carry else 0 end)
       or (a ->> 'paidMinor')::bigint + (a ->> 'unclaimedMinor')::bigint <> (a ->> 'fundMinor')::bigint then
      raise exception 'RESULT_MISMATCH: tier % allocation is wrong', t using errcode = 'P0001';
    end if;
    select count(*), coalesce(min((x ->> 'amountMinor')::bigint), 0), coalesce(max((x ->> 'amountMinor')::bigint), 0),
           coalesce(sum((x ->> 'amountMinor')::bigint), 0)
      into v_count, v_min, v_max, v_sum
      from jsonb_array_elements(p_result -> 'payouts') x where (x ->> 'tier')::integer = t;
    if v_count <> (a ->> 'winnerCount')::integer
       or v_count <> (select count(*) from jsonb_array_elements(p_result -> 'matches') mm where (mm ->> 'tier')::integer = t)
       or v_sum <> (a ->> 'paidMinor')::bigint
       or v_max - v_min > 1
       or (v_count = 0 and (a ->> 'unclaimedMinor')::bigint <> (a ->> 'fundMinor')::bigint)
       or (v_count > 0 and (a ->> 'unclaimedMinor')::bigint <> 0) then
      raise exception 'RESULT_MISMATCH: tier % winners/split are inconsistent', t using errcode = 'P0001';
    end if;
    v_rolls := coalesce((v_cfg #>> array['rollover', t::text])::boolean, false) or (v_cfg ->> 'unclaimedPolicy') = 'jackpot';
    v_paid := v_paid + (a ->> 'paidMinor')::bigint;
    if v_rolls then v_out := v_out + (a ->> 'unclaimedMinor')::bigint;
    else v_res := v_res + (a ->> 'unclaimedMinor')::bigint; end if;
  end loop;
  if jsonb_array_length(p_result -> 'allocations') <> 3
     or (p_result ->> 'carryOutMinor')::bigint <> v_out
     or (p_result ->> 'reserveMinor')::bigint <> v_res
     or v_paid + v_out + v_res <> v_pool + v_carry then
    raise exception 'RESULT_MISMATCH: money is not conserved (paid %, carry-out %, reserve %, funded %)',
      v_paid, v_out, v_res, v_pool + v_carry using errcode = 'P0001';
  end if;

  -- 5. write everything (one transaction: all or nothing)
  for m in select * from jsonb_array_elements(p_result -> 'matches') loop
    insert into public.draw_matches (draw_id, user_id, match_count, tier)
    values (p_draw, (m ->> 'userId')::uuid, (m ->> 'matches')::smallint, (m ->> 'tier')::smallint);
  end loop;
  for a in select * from jsonb_array_elements(p_result -> 'allocations') loop
    insert into public.prize_allocations (draw_id, tier, allocation_minor, carry_in_minor, fund_minor,
                                          winner_count, paid_minor, unclaimed_minor)
    values (p_draw, (a ->> 'tier')::smallint, (a ->> 'allocationMinor')::bigint, (a ->> 'carryInMinor')::bigint,
            (a ->> 'fundMinor')::bigint, (a ->> 'winnerCount')::integer, (a ->> 'paidMinor')::bigint,
            (a ->> 'unclaimedMinor')::bigint);
  end loop;
  for p in select * from jsonb_array_elements(p_result -> 'payouts') loop
    insert into public.winnings (draw_id, user_id, tier, amount_minor)
    values (p_draw, (p ->> 'userId')::uuid, (p ->> 'tier')::smallint, (p ->> 'amountMinor')::bigint);
    insert into public.notifications (user_id, kind, title, body, ref)
    values ((p ->> 'userId')::uuid, 'winning', 'You have a prize to claim',
            'You matched ' || (p ->> 'tier') || ' numbers in ' || v_draw.title || '. Upload your score screenshot to start verification.',
            jsonb_build_object('draw_id', p_draw));
  end loop;
  for e in select * from jsonb_array_elements(p_result -> 'ledger') loop
    v_seq := v_seq + 1;
    insert into public.draw_ledger_entries (draw_id, seq, from_account, to_account, amount_minor, kind, ref)
    values (p_draw, v_seq, e ->> 'from', e ->> 'to', (e ->> 'amountMinor')::bigint, e ->> 'kind', e ->> 'ref');
  end loop;

  if v_carry > 0 then
    insert into public.jackpot_ledger (draw_id, entry_type, delta_minor) values (p_draw, 'carry_in_consumed', -v_carry);
  end if;
  if v_out > 0 then
    insert into public.jackpot_ledger (draw_id, entry_type, delta_minor) values (p_draw, 'rollover_created', v_out);
  end if;

  insert into public.ledger_groups (idempotency_key, kind, description)
  values ('draw:' || p_draw || ':publish', 'draw_publication', 'Prize allocation for ' || v_draw.title)
  returning id into v_group;
  if v_pool > 0 then insert into public.financial_ledger (group_id, account, direction, amount_minor, ref_type, ref_id)
    values (v_group, 'prize_pool', 'debit', v_pool, 'draw', p_draw::text); end if;
  if v_carry > 0 then insert into public.financial_ledger (group_id, account, direction, amount_minor, ref_type, ref_id)
    values (v_group, 'jackpot_carry', 'debit', v_carry, 'draw', p_draw::text); end if;
  if v_paid > 0 then insert into public.financial_ledger (group_id, account, direction, amount_minor, ref_type, ref_id)
    values (v_group, 'prize_payable', 'credit', v_paid, 'draw', p_draw::text); end if;
  if v_out > 0 then insert into public.financial_ledger (group_id, account, direction, amount_minor, ref_type, ref_id)
    values (v_group, 'jackpot_carry', 'credit', v_out, 'draw', p_draw::text); end if;
  if v_res > 0 then insert into public.financial_ledger (group_id, account, direction, amount_minor, ref_type, ref_id)
    values (v_group, 'reserve_unclaimed', 'credit', v_res, 'draw', p_draw::text); end if;

  update public.draws set status = 'published', winning_numbers = v_nums,
         weights = p_result -> 'weights', random_source = p_result ->> 'randomSource',
         result_hash = p_result ->> 'resultHash', published_at = now(), published_by = p_actor
   where id = p_draw;

  perform public.write_audit(p_actor, 'draw.published', 'draw', p_draw::text, null,
    jsonb_build_object('winning_numbers', v_nums, 'result_hash', p_result ->> 'resultHash',
                       'paid_minor', v_paid, 'carry_out_minor', v_out, 'reserve_minor', v_res,
                       'random_source', p_result ->> 'randomSource'));
  return jsonb_build_object('status', 'published', 'draw_id', p_draw, 'result_hash', p_result ->> 'resultHash',
                            'winners', jsonb_array_length(p_result -> 'payouts'));
end $$;

-- ------------------------------------------------- evidence / payouts (claims) -
create or replace function public.submit_evidence(p_winning uuid, p_path text, p_mime text, p_size integer)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_w public.winnings; v_id uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select * into v_w from public.winnings where id = p_winning and user_id = v_uid for update;
  if not found then raise exception 'NOT_FOUND: winning not found' using errcode = 'P0001'; end if;
  if v_w.claim_status not in ('not_submitted', 'rejected') then
    raise exception 'TRANSITION: evidence cannot be submitted while the claim is %', v_w.claim_status using errcode = 'P0001';
  end if;
  if p_path is null or p_path !~ ('^' || v_uid::text || '/[^/]+/[^/]+$') then
    raise exception 'INVALID_PATH: upload path must be inside your own folder' using errcode = 'P0001';
  end if;
  insert into public.winner_evidence (winning_id, user_id, storage_path, mime_type, size_bytes)
  values (p_winning, v_uid, p_path, p_mime, p_size) returning id into v_id;
  update public.winnings set claim_status = 'pending_review', rejection_reason = null where id = p_winning;
  return v_id;
end $$;

create or replace function public.review_evidence(p_evidence uuid, p_actor uuid, p_approve boolean, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ev public.winner_evidence; v_w public.winnings;
begin
  perform public.assert_admin(p_actor);
  select * into v_ev from public.winner_evidence where id = p_evidence for update;
  if not found then raise exception 'NOT_FOUND: evidence' using errcode = 'P0001'; end if;
  select * into v_w from public.winnings where id = v_ev.winning_id for update;
  if v_ev.review_status <> 'pending' or v_w.claim_status <> 'pending_review' then
    raise exception 'TRANSITION: this submission has already been reviewed' using errcode = 'P0001';
  end if;
  if not p_approve and (p_reason is null or char_length(trim(p_reason)) < 5) then
    raise exception 'REASON_REQUIRED: give the winner a reason for the rejection' using errcode = 'P0001';
  end if;
  update public.winner_evidence set
    review_status = case when p_approve then 'approved'::public.review_status else 'rejected'::public.review_status end,
    reviewed_by = p_actor, reviewed_at = now(), rejection_reason = case when p_approve then null else p_reason end
   where id = p_evidence;
  update public.winnings set
    claim_status = case when p_approve then 'approved'::public.claim_status else 'rejected'::public.claim_status end,
    rejection_reason = case when p_approve then null else p_reason end
   where id = v_w.id;
  insert into public.notifications (user_id, kind, title, body, ref) values
    (v_w.user_id, 'evidence_review',
     case when p_approve then 'Your proof was approved' else 'Your proof needs another look' end,
     case when p_approve then 'We''ll queue your payout next.' else p_reason end,
     jsonb_build_object('winning_id', v_w.id));
  perform public.write_audit(p_actor, case when p_approve then 'evidence.approved' else 'evidence.rejected' end,
    'winning', v_w.id::text, jsonb_build_object('claim_status', v_w.claim_status),
    jsonb_build_object('claim_status', case when p_approve then 'approved' else 'rejected' end), p_reason);
end $$;

create or replace function public.queue_payout(p_winning uuid, p_actor uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_w public.winnings; v_id uuid;
begin
  perform public.assert_admin(p_actor);
  select * into v_w from public.winnings where id = p_winning for update;
  if not found then raise exception 'NOT_FOUND: winning' using errcode = 'P0001'; end if;
  if v_w.claim_status = 'payout_pending' then
    select id into v_id from public.payouts where winning_id = p_winning;
    return v_id;                                   -- idempotent replay
  end if;
  if v_w.claim_status <> 'approved' then
    raise exception 'TRANSITION: only an approved claim can be queued for payout (currently %)', v_w.claim_status using errcode = 'P0001';
  end if;
  insert into public.payouts (winning_id, amount_minor) values (p_winning, v_w.amount_minor) returning id into v_id;
  update public.winnings set claim_status = 'payout_pending' where id = p_winning;
  perform public.write_audit(p_actor, 'payout.queued', 'winning', p_winning::text, null,
                             jsonb_build_object('amount_minor', v_w.amount_minor));
  return v_id;
end $$;

-- Marks a payout as paid. It RECORDS that an external transfer was made (the reference is the
-- bank/UPI transaction id); this platform does not move money itself.
create or replace function public.mark_payout_paid(
  p_winning uuid, p_actor uuid, p_reference text, p_method text, p_notes text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_w public.winnings; v_pay public.payouts; v_group uuid;
begin
  perform public.assert_admin(p_actor);
  select * into v_w from public.winnings where id = p_winning for update;
  if not found then raise exception 'NOT_FOUND: winning' using errcode = 'P0001'; end if;
  select * into v_pay from public.payouts where winning_id = p_winning;

  if v_w.claim_status = 'paid' then
    if v_pay.reference = p_reference then
      return jsonb_build_object('status', 'already_paid', 'idempotent', true, 'payout_id', v_pay.id);
    end if;
    raise exception 'PAYOUT_REFERENCE_CONFLICT: this winning was already paid under reference %', v_pay.reference using errcode = 'P0001';
  end if;
  if v_w.claim_status <> 'payout_pending' then
    raise exception 'TRANSITION: a % claim cannot be marked paid', v_w.claim_status using errcode = 'P0001';
  end if;
  if p_reference is null or char_length(trim(p_reference)) < 4 then
    raise exception 'REFERENCE_REQUIRED: enter the external transfer reference' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payouts where reference = p_reference and winning_id <> p_winning) then
    raise exception 'PAYOUT_REFERENCE_CONFLICT: that reference was already used for another payout' using errcode = 'P0001';
  end if;

  update public.payouts set status = 'paid', reference = trim(p_reference), method = p_method, notes = p_notes,
         paid_at = now(), paid_by = p_actor where id = v_pay.id;
  update public.winnings set claim_status = 'paid' where id = p_winning;

  insert into public.ledger_groups (idempotency_key, kind, description)
  values ('payout:' || p_winning, 'prize_payout', 'Prize payout recorded as paid (external transfer attested by admin)')
  returning id into v_group;
  insert into public.financial_ledger (group_id, account, direction, amount_minor, ref_type, ref_id) values
    (v_group, 'prize_payable', 'debit', v_w.amount_minor, 'winning', p_winning::text),
    (v_group, 'cash', 'credit', v_w.amount_minor, 'winning', p_winning::text);

  insert into public.notifications (user_id, kind, title, body, ref) values
    (v_w.user_id, 'payout_paid', 'Your prize has been marked as paid',
     'Reference: ' || trim(p_reference), jsonb_build_object('winning_id', p_winning));
  perform public.write_audit(p_actor, 'payout.paid', 'winning', p_winning::text, null,
    jsonb_build_object('reference', trim(p_reference), 'amount_minor', v_w.amount_minor), p_notes);
  return jsonb_build_object('status', 'paid', 'idempotent', false, 'payout_id', v_pay.id);
end $$;

-- ----------------------------------------------------------- admin bootstrap --
-- Callable ONLY by service_role / postgres (see grants). There is no public path to admin.
create or replace function public.promote_to_admin(p_email text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  update public.profiles set role = 'admin' where lower(email) = lower(p_email) returning id into v_id;
  if v_id is null then return false; end if;
  perform public.write_audit(v_id, 'admin.promoted', 'profile', v_id::text, null,
                             jsonb_build_object('via', 'promote_to_admin'));
  return true;
end $$;

-- ------------------------------------------------------- reconciliation views --
create or replace view public.v_ledger_balances with (security_invoker = true) as
  select account,
         coalesce(sum(amount_minor) filter (where direction = 'debit'), 0)::bigint  as debit_minor,
         coalesce(sum(amount_minor) filter (where direction = 'credit'), 0)::bigint as credit_minor,
         (coalesce(sum(amount_minor) filter (where direction = 'credit'), 0)
          - coalesce(sum(amount_minor) filter (where direction = 'debit'), 0))::bigint as credit_balance_minor
    from public.financial_ledger group by account;

-- Every figure shown in reports should reconcile to its operational source. ok=false means a bug or tampering.
create or replace view public.v_reconciliation with (security_invoker = true) as
  with bal as (select account, credit_balance_minor b from public.v_ledger_balances)
  select 'prize_pool = unspent pool contributions'::text as check_name,
         coalesce((select b from bal where account = 'prize_pool'), 0)::bigint as ledger_minor,
         coalesce((select sum(c.pool_minor) from public.contributions c
                    where c.draw_id is null or c.draw_id in (select id from public.draws where status <> 'published')), 0)::bigint as source_minor
  union all
  select 'jackpot_carry = jackpot_ledger',
         coalesce((select b from bal where account = 'jackpot_carry'), 0)::bigint,
         coalesce((select sum(delta_minor) from public.jackpot_ledger), 0)::bigint
  union all
  select 'deferred_revenue = unrecognised instalments',
         coalesce((select b from bal where account = 'deferred_revenue'), 0)::bigint,
         coalesce((select sum(amount_minor) from public.recognition_schedule where recognized_at is null), 0)::bigint
  union all
  select 'charity_payable = recognised charity contributions',
         coalesce((select b from bal where account = 'charity_payable'), 0)::bigint,
         coalesce((select sum(charity_minor) from public.contributions), 0)::bigint
  union all
  select 'prize_payable = unpaid winnings',
         coalesce((select b from bal where account = 'prize_payable'), 0)::bigint,
         coalesce((select sum(amount_minor) from public.winnings where claim_status <> 'paid'), 0)::bigint
  union all
  select 'reserve_unclaimed = draw reserves',
         coalesce((select b from bal where account = 'reserve_unclaimed'), 0)::bigint,
         coalesce((select sum(unclaimed_minor) from public.prize_allocations pa
                    join public.draws d on d.id = pa.draw_id
                   where not (coalesce((d.tier_config #>> array['rollover', pa.tier::text])::boolean, false)
                              or d.tier_config ->> 'unclaimedPolicy' = 'jackpot')), 0)::bigint;
-- =============================================================================
-- Row Level Security + privilege lockdown.
--
-- THREE ACCESS TIERS (see docs/SECURITY.md):
--   1. Browser / anon key  -> role anon / authenticated. RLS applies. Read-mostly, own rows only.
--      Writes happen only through the few SECURITY DEFINER RPCs granted below.
--   2. Server (service-role key, never shipped to the browser) -> role service_role. Bypasses RLS,
--      so every call site first runs requireAdmin()/requireActor() in TypeScript, and the admin
--      SQL functions re-check the actor's role themselves (assert_admin).
--   3. Postgres owner / migrations.
-- =============================================================================

-- Start from zero privileges, then grant back exactly what is needed.
revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- Enable RLS everywhere (a table with RLS on and no policy denies everything to clients).
alter table public.profiles             enable row level security;
alter table public.app_settings         enable row level security;
alter table public.plans                enable row level security;
alter table public.charities            enable row level security;
alter table public.charity_events       enable row level security;
alter table public.charity_selections   enable row level security;
alter table public.subscriptions        enable row level security;
alter table public.subscription_history enable row level security;
alter table public.scores               enable row level security;
alter table public.draws                enable row level security;
alter table public.draw_simulations     enable row level security;
alter table public.draw_participants    enable row level security;
alter table public.draw_score_snapshots enable row level security;
alter table public.draw_matches         enable row level security;
alter table public.prize_allocations    enable row level security;
alter table public.draw_ledger_entries  enable row level security;
alter table public.jackpot_ledger       enable row level security;
alter table public.winnings             enable row level security;
alter table public.winner_evidence      enable row level security;
alter table public.payouts              enable row level security;
alter table public.contributions        enable row level security;
alter table public.recognition_schedule enable row level security;
alter table public.ledger_groups        enable row level security;
alter table public.financial_ledger     enable row level security;
alter table public.notifications        enable row level security;
alter table public.audit_logs           enable row level security;
alter table public.webhook_events       enable row level security;

-- ------------------------------------------------------------ table grants ----
-- Public catalogue data
grant select on public.plans, public.charities, public.charity_events to anon, authenticated;
grant select on public.app_settings to anon, authenticated;
-- Published draw results (the rows themselves are filtered by policy)
grant select on public.draws, public.prize_allocations to anon, authenticated;
-- Own-data reads
grant select on public.profiles, public.charity_selections, public.subscriptions, public.scores,
                public.draw_participants, public.draw_score_snapshots, public.draw_matches,
                public.winnings, public.winner_evidence, public.payouts, public.contributions,
                public.notifications to authenticated;
-- Column-limited writes (everything else is RPC / service role)
grant update (display_name, terms_accepted_at, terms_version, onboarding_completed_at) on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;
-- Admin console reads happen via the service role; admin-readable policies below also allow an
-- authenticated admin session to read directly.
grant select on public.audit_logs, public.draw_simulations, public.draw_ledger_entries, public.jackpot_ledger,
                public.financial_ledger, public.ledger_groups, public.recognition_schedule,
                public.subscription_history to authenticated;
grant select on public.v_ledger_balances, public.v_reconciliation to authenticated;
-- webhook_events: no client grant at all.

-- ----------------------------------------------------------------- policies ---
-- profiles
create policy profiles_select_own   on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update_own   on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- public catalogue
create policy plans_read            on public.plans for select to anon, authenticated using (is_active);
create policy settings_read_public  on public.app_settings for select to anon, authenticated
  using (is_public or public.is_admin());
create policy charities_read        on public.charities for select to anon, authenticated
  using (status = 'active' or public.is_admin());
create policy charity_events_read   on public.charity_events for select to anon, authenticated
  using (status = 'published' and exists (select 1 from public.charities c where c.id = charity_id and c.status = 'active')
         or public.is_admin());

-- own data
create policy selections_own        on public.charity_selections for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy subscriptions_own     on public.subscriptions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy sub_history_admin     on public.subscription_history for select to authenticated
  using (public.is_admin());
create policy scores_own            on public.scores for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy contributions_own     on public.contributions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy notifications_own     on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_mark    on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- draws: only PUBLISHED results are public; drafts, simulations and approvals are admin-only.
create policy draws_public          on public.draws for select to anon, authenticated
  using (status = 'published' or public.is_admin());
create policy allocations_public    on public.prize_allocations for select to anon, authenticated
  using (exists (select 1 from public.draws d where d.id = draw_id and d.status = 'published') or public.is_admin());
create policy simulations_admin     on public.draw_simulations for select to authenticated using (public.is_admin());

-- a participant sees ONLY their own frozen snapshot and own result, never anyone else's
create policy participants_own      on public.draw_participants for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy snapshots_own         on public.draw_score_snapshots for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy matches_own           on public.draw_matches for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- internal ledgers: admin only
create policy draw_ledger_admin     on public.draw_ledger_entries for select to authenticated using (public.is_admin());
create policy jackpot_admin         on public.jackpot_ledger for select to authenticated using (public.is_admin());
create policy fin_ledger_admin      on public.financial_ledger for select to authenticated using (public.is_admin());
create policy ledger_groups_admin   on public.ledger_groups for select to authenticated using (public.is_admin());
create policy recognition_admin     on public.recognition_schedule for select to authenticated using (public.is_admin());
create policy audit_admin           on public.audit_logs for select to authenticated using (public.is_admin());

-- winnings & evidence: the winner and admins. Writes only through submit_evidence / admin functions.
create policy winnings_own          on public.winnings for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy evidence_own          on public.winner_evidence for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy payouts_own           on public.payouts for select to authenticated
  using (exists (select 1 from public.winnings w where w.id = winning_id and w.user_id = auth.uid()) or public.is_admin());

-- ----------------------------------------------------------- function grants ---
-- Used inside policies / by clients:
grant execute on function public.is_admin()               to anon, authenticated;
grant execute on function public.public_jackpot_balance() to anon, authenticated;
grant execute on function public.max_score_date()         to anon, authenticated;
-- Client-callable RPCs (each derives the actor from auth.uid(), never from a parameter):
grant execute on function public.add_score(date, integer)            to authenticated;
grant execute on function public.update_score(uuid, date, integer)   to authenticated;
grant execute on function public.delete_score(uuid)                  to authenticated;
grant execute on function public.select_charity(uuid, integer)       to authenticated;
grant execute on function public.submit_evidence(uuid, text, text, integer) to authenticated;
-- The wrappers are SECURITY DEFINER and take the user id from auth.uid() only, so a caller can never
-- address another user's scores. The underscore functions (which accept a user id) are NOT granted
-- to clients; only service_role (admin score edits) and the definer wrappers can run them.

-- Everything else (admin + billing + draw functions) is service_role only.
grant execute on all functions in schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
-- Contact form inbox + evidence storage bucket and policies.

create table public.contact_messages (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 100),
  email       text not null check (char_length(email) <= 254),
  topic       text not null check (topic in ('general', 'support', 'charity', 'press')),
  message     text not null check (char_length(message) between 10 and 4000),
  created_at  timestamptz not null default now(),
  handled_at  timestamptz
);
alter table public.contact_messages enable row level security;
-- No client policies at all: inserts happen from a validated, rate-limited server action
-- using the service role; admins read through the console.
revoke all on public.contact_messages from anon, authenticated;
grant all on public.contact_messages to service_role;

-- Storage: private bucket for winner evidence. Objects live at <user_id>/<winning_id>/<file>.
-- Guarded so the migration also runs on plain Postgres (e.g. the PGlite test harness).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('winner-evidence', 'winner-evidence', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = 5242880,
      allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

    execute $p$create policy evidence_upload_own on storage.objects for insert to authenticated
      with check (bucket_id = 'winner-evidence' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy evidence_read_own on storage.objects for select to authenticated
      using (bucket_id = 'winner-evidence' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()))$p$;
    -- No update/delete policy: uploaded evidence is immutable from the client side.
  end if;
end $$;
