-- Milestone 27: profile bio.

alter table public.profiles add column if not exists bio text;
alter table public.profiles drop constraint if exists profiles_bio_length;
alter table public.profiles add constraint profiles_bio_length check (bio is null or char_length(bio) <= 150);

-- Drop and recreate rather than CREATE OR REPLACE - see 0022_profile_handle's
-- comment: Postgres matches replaced-view columns positionally and rejects
-- this as a rename via OR REPLACE. Nothing else is built on top of this view.
drop view if exists public.public_profiles cascade;

create view public.public_profiles
  with (security_invoker = false) as
  select id, display_name, avatar_url, bio, hide_stats_from_friends, hide_photos_from_friends, handle
  from public.profiles;

grant select on public.public_profiles to authenticated;
