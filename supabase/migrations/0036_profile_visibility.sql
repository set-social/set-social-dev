-- Milestone 36: private/public profile — controls whether adding this
-- athlete as a friend requires their approval (private, the default —
-- exactly matches every profile's existing behavior before this migration)
-- or connects instantly with no request needed (public), mirroring
-- Instagram's private-account toggle.

alter table public.profiles add column is_private boolean not null default true;

-- Postgres only lets `create or replace view` append columns at the end,
-- not insert one — drop+recreate is this schema's established way around
-- that (see 0022_profile_handle.sql / 0027_profile_bio.sql). Exposed here so
-- friend-facing screens can tell "requires approval" apart from "connects
-- instantly" before the athlete even taps Add Friend.
drop view if exists public.public_profiles cascade;

create view public.public_profiles
  with (security_invoker = false) as
  select id, display_name, avatar_url, bio, hide_stats_from_friends, hide_photos_from_friends, handle, is_private
  from public.profiles;

grant select on public.public_profiles to authenticated;

-- Tightens friend_requests_insert_own to also require a fresh insert start
-- pending — status only ever advances from there via the addressee's own
-- accept/decline (friend_requests_update_addressee) or, new here, the
-- trigger below. Closes a latent gap where a client could otherwise insert
-- an already-"accepted" row directly, bypassing consent entirely.
drop policy "friend_requests_insert_own" on public.friend_requests;

create policy "friend_requests_insert_own" on public.friend_requests
  for insert with check (auth.uid() = requester_id and status = 'pending');

-- Auto-accepts a request the instant it's created if the addressee's
-- profile is public — the one path besides the addressee themself allowed
-- to move a request straight to 'accepted'. Runs server-side (reading the
-- addressee's real is_private value directly) rather than trusting the
-- client to declare it, so a requester can't spoof a private profile into
-- an instant accept.
create or replace function public.friend_requests_auto_accept_if_public()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' and not (
    select is_private from public.profiles where id = new.addressee_id
  ) then
    new.status := 'accepted';
    new.resolved_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists friend_requests_auto_accept_before_insert on public.friend_requests;

create trigger friend_requests_auto_accept_before_insert
  before insert on public.friend_requests
  for each row
  execute function public.friend_requests_auto_accept_if_public();
