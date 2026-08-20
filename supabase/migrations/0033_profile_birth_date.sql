-- Milestone 33: birth date, collected at sign-up going forward (also backs a
-- minimum-age check — under-13 accounts are blocked client-side, this is the
-- server-side backstop). Private — deliberately not added to
-- public_profiles; nothing outside the owner's own session needs it.

alter table public.profiles add column if not exists birth_date date;

alter table public.profiles drop constraint if exists profiles_birth_date_min_age;
alter table public.profiles
  add constraint profiles_birth_date_min_age
  check (birth_date is null or birth_date <= (current_date - interval '13 years'));

-- Lets the sign-up form check @handle availability before an account (and
-- thus a session) exists — profiles_select_own only allows reading your own
-- row, so an unauthenticated client has no other way to know a handle is
-- already taken until the post-signup profile update's unique-index
-- violation, by which point the auth user has already been created. This
-- exposes only a boolean, never any profile data.
create or replace function public.is_handle_taken(p_handle text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where handle = lower(p_handle));
$$;

grant execute on function public.is_handle_taken(text) to anon, authenticated;
