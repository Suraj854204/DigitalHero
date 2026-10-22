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
