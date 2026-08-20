-- Milestone 2: profiles table, RLS, and auto-provisioning on signup.

create type public.experience_level as enum ('beginner', 'intermediate', 'advanced');
create type public.training_goal as enum ('strength', 'hypertrophy', 'endurance', 'general_fitness');
create type public.unit_preference as enum ('kg', 'lb');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  avatar_url text,
  experience_level public.experience_level,
  goal public.training_goal,
  days_per_week smallint check (days_per_week between 1 and 7),
  equipment_access text[] not null default '{}',
  injuries_notes text,
  unit_preference public.unit_preference not null default 'kg',
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No insert policy for clients: rows are created only by the handle_new_user
-- trigger below, which runs as the table owner and bypasses RLS.

-- Public, non-PII slice used by community/leaderboard features (Milestone 8+).
create view public.public_profiles
  with (security_invoker = true) as
  select id, display_name, avatar_url
  from public.profiles;

grant select on public.public_profiles to authenticated;

-- Auto-provision a profile row whenever a new auth user is created.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep updated_at current on every row update.
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
