-- Milestone: AI Form Check (Beta) — athlete uploads a photo or a handful of
-- video frames of themselves doing an exercise, Arnold (chat-coach's same
-- Claude model, via the new form-check Edge Function) reviews it and returns
-- a short list of form cues + tips.
--
-- Deliberately NOT modeled on chat-photos/food_log_entries (0063): those
-- keep the athlete's photo forever. Form Check's privacy requirement is the
-- opposite — the source image must never be persisted anywhere. That's why
-- form_check_results carries no photo_path column at all, and why the
-- form-check function (see supabase/functions/form-check) deletes the
-- uploaded file the moment it's done with it, with this migration's cron
-- sweep as a backstop for an upload that's abandoned mid-flow.

create type public.form_check_confidence as enum ('high', 'medium', 'low');

create table public.form_check_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  exercise_name text not null,
  summary text not null,
  -- [{ label: string, status: 'good' | 'warning', note: string }]
  cues jsonb not null,
  tips text[] not null default '{}',
  confidence public.form_check_confidence not null,
  created_at timestamptz not null default now()
);

create index form_check_results_user_id_idx on public.form_check_results (user_id);

alter table public.form_check_results enable row level security;

create policy "form_check_results_all_own"
  on public.form_check_results for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Private, owner-folder-scoped bucket — same shape as chat-photos (0063),
-- except nothing uploaded here is meant to outlive a single analysis call.
insert into storage.buckets (id, name, public)
values ('form-check-photos', 'form-check-photos', false)
on conflict (id) do nothing;

create policy "form_check_photos_owner_all" on storage.objects
  for all
  using (bucket_id = 'form-check-photos' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'form-check-photos' and auth.uid()::text = (storage.foldername(name))[1]);

-- Safety-net sweep: the form-check Edge Function deletes what it uploads as
-- soon as it's done (success or failure), but a client that uploads frames
-- and then loses connection, backgrounds the app, or force-quits before
-- calling it would otherwise leave orphaned files behind forever. This
-- catches those every 20 minutes. Same pg_cron + net.http_post shape as
-- run_proactive_coach_sweep (0059_proactive_coach.sql), reusing its already-
-- configured push_functions_url/push_service_role_key Vault secrets rather
-- than provisioning new ones.
create or replace function public.run_form_check_cleanup_sweep()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_functions_url text;
  v_service_role_key text;
begin
  select decrypted_secret into v_functions_url
    from vault.decrypted_secrets where name = 'push_functions_url';
  select decrypted_secret into v_service_role_key
    from vault.decrypted_secrets where name = 'push_service_role_key';

  if v_functions_url is null or v_service_role_key is null then
    return;
  end if;

  perform net.http_post(
    url := v_functions_url || '/form-check-cleanup-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body := '{}'::jsonb
  );
exception when others then
  null;
end;
$$;

revoke execute on function public.run_form_check_cleanup_sweep() from public, anon, authenticated;

select cron.schedule('form-check-cleanup-sweep', '*/20 * * * *', $$select public.run_form_check_cleanup_sweep()$$);
