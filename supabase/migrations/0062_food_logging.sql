-- Milestone 62: manual food logging + a nutrition goal, phase 1 of the AI
-- Coach energy-balance feature. Deliberately minimal — no photo_url or
-- confidence/source columns yet, since this phase has no photos or AI
-- estimates to describe; those arrive with the phase that needs them.
--
-- nutrition_goal is a separate axis from profiles.goal (public.training_goal
-- — strength/hypertrophy/endurance/general_fitness): that's about how you
-- train, this is about body composition intent, and the two are independent
-- (e.g. someone can run a hypertrophy program while cutting).

create type public.meal_type as enum ('breakfast', 'lunch', 'dinner', 'snack');
create type public.nutrition_goal as enum ('cut', 'bulk', 'maintain');

alter table public.profiles
  add column if not exists nutrition_goal public.nutrition_goal not null default 'maintain';

create table public.food_log_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  logged_at timestamptz not null default now(),
  name text not null,
  meal_type public.meal_type,
  calories integer not null check (calories >= 0),
  protein_g numeric(6, 1) not null default 0 check (protein_g >= 0),
  carbs_g numeric(6, 1) not null default 0 check (carbs_g >= 0),
  fat_g numeric(6, 1) not null default 0 check (fat_g >= 0),
  created_at timestamptz not null default now()
);

create index food_log_entries_user_id_idx on public.food_log_entries (user_id);

alter table public.food_log_entries enable row level security;

create policy "food_log_entries_all_own"
  on public.food_log_entries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
