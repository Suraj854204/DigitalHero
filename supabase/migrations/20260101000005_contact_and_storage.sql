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
