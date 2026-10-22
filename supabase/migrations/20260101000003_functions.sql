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
