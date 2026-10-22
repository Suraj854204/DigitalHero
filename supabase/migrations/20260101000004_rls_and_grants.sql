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
