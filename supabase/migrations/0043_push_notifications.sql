-- Milestone 43: push notifications, part 1 — device tokens, per-category
-- preferences, and the immediate (non-batched) triggers: new message, new
-- friend request, and friend request accepted. Photo likes/comments are
-- batched and land in 0044_push_batching.sql instead.
--
-- Dispatch model: triggers below call public.push_dispatch(), a thin
-- wrapper around pg_net that POSTs to the send-push Edge Function
-- fire-and-forget (pg_net queues the HTTP call and returns immediately, so
-- a slow or failing push never holds up the write that triggered it). The
-- function itself decides recipient/copy/tokens/preferences — triggers only
-- ever pass the id of the row that changed.
--
-- Two settings this relies on are deliberately NOT set here (they're
-- secrets, not schema) — run once per environment from the SQL editor:
--   alter database postgres set app.settings.supabase_functions_url = 'https://<project-ref>.supabase.co/functions/v1';
--   alter database postgres set app.settings.service_role_key = '<service role key>';
-- Until both are set, push_dispatch's http_post calls silently no-op-fail
-- (pg_net logs the error to net._http_response; nothing else breaks).

create extension if not exists pg_net with schema extensions;

create table public.push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null default 'ios' check (platform = 'ios'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_tokens_user_id_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

create policy "push_tokens_select_own" on public.push_tokens
  for select using (auth.uid() = user_id);

create policy "push_tokens_insert_own" on public.push_tokens
  for insert with check (auth.uid() = user_id);

-- Lets the client re-upsert on every app open (bumping last_seen_at) without
-- a separate "already registered" check.
create policy "push_tokens_update_own" on public.push_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "push_tokens_delete_own" on public.push_tokens
  for delete using (auth.uid() = user_id);

-- One boolean per category from the reviewed notification-settings mockup.
-- Messages has no corresponding toggle in the UI (it's presented as
-- always-on there) but still gets a column, for schema symmetry and in case
-- that changes later — send-push checks it like any other category.
alter table public.profiles
  add column push_messages_enabled boolean not null default true,
  add column push_friends_enabled boolean not null default true,
  add column push_activity_enabled boolean not null default true,
  add column push_ai_coach_enabled boolean not null default true,
  -- Set once, the first time the in-app permission primer is shown, so it
  -- never reappears for an athlete who already dismissed or acted on it.
  add column push_primer_shown_at timestamptz;

create function public.push_dispatch(payload jsonb)
returns void
language plpgsql
as $$
begin
  perform net.http_post(
    url := current_setting('app.settings.supabase_functions_url', true) || '/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := payload
  );
end;
$$;

-- New Message — fires for every insert, including the first message of a
-- still-pending DM request; send-push resolves "the other participant" and
-- their push_messages_enabled itself, so this trigger stays a one-liner.
create function public.dm_messages_push()
returns trigger
language plpgsql
as $$
begin
  perform public.push_dispatch(jsonb_build_object('type', 'message', 'message_id', new.id));
  return new;
end;
$$;

create trigger dm_messages_push_after_insert
  after insert on public.dm_messages
  for each row execute function public.dm_messages_push();

-- Friend Request / Friend Request Accepted — a single insert can land as
-- either 'pending' or already 'accepted' (public-profile auto-accept, see
-- 0036_profile_visibility.sql), so the insert trigger picks the right push
-- type from the row's actual resulting status rather than assuming.
create function public.friend_requests_push_on_insert()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'pending' then
    perform public.push_dispatch(jsonb_build_object('type', 'friend_request', 'request_id', new.id));
  elsif new.status = 'accepted' then
    perform public.push_dispatch(jsonb_build_object('type', 'friend_request_accepted', 'request_id', new.id));
  end if;
  return new;
end;
$$;

create trigger friend_requests_push_after_insert
  after insert on public.friend_requests
  for each row execute function public.friend_requests_push_on_insert();

-- The other path to 'accepted' — the addressee manually accepting a private
-- profile's pending request via friend_requests_update_addressee.
create function public.friend_requests_push_on_accept()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'pending' and new.status = 'accepted' then
    perform public.push_dispatch(jsonb_build_object('type', 'friend_request_accepted', 'request_id', new.id));
  end if;
  return new;
end;
$$;

create trigger friend_requests_push_after_update
  after update on public.friend_requests
  for each row execute function public.friend_requests_push_on_accept();
