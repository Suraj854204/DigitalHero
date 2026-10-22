-- =============================================================================
-- Digital Heroes :: core schema (profiles, charities, subscriptions, scores)
-- All money is stored as integer minor units (paise). No floats, no numeric(…,2).
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
