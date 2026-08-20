-- Milestone 22: user-chosen @handles, searchable from the community "find
-- an athlete" box alongside display name.
--
-- Written to be safe to re-run: the first attempt at this migration failed
-- partway through (the view replace below hit 42P16), so every statement
-- here is guarded to not fail if it already partially applied.

alter table public.profiles add column if not exists handle text;

alter table public.profiles drop constraint if exists profiles_handle_format;
alter table public.profiles
  add constraint profiles_handle_format check (handle is null or handle ~ '^[a-z0-9_]{3,20}$');

-- Partial unique index (not a plain unique constraint) so multiple rows can
-- still hold null before a user ever sets one.
create unique index if not exists profiles_handle_unique_idx on public.profiles (handle) where handle is not null;

-- Drop and recreate rather than CREATE OR REPLACE: this migration hit 42P16
-- twice via OR REPLACE (Postgres matches replaced-view columns positionally,
-- not by name, and rejects anything that reads as renaming an existing
-- position — evidently true here regardless of where `handle` was placed
-- in the select list, which points at the live view's column order already
-- having drifted from what 0021 defines). Drop+recreate sidesteps that
-- entirely; nothing else in the schema is built on top of this view.
drop view if exists public.public_profiles cascade;

create view public.public_profiles
  with (security_invoker = false) as
  select id, display_name, avatar_url, hide_stats_from_friends, hide_photos_from_friends, handle
  from public.profiles;

grant select on public.public_profiles to authenticated;
