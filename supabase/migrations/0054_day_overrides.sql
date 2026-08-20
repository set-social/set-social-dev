-- Lets an athlete explicitly reclassify a single past date that already had
-- a plan (a recurring weekly_schedule day, an active program's day, or an
-- ad-hoc scheduled workout) as rest or missed, without touching the
-- recurring/program row itself — e.g. marking last Sunday's cardio day as
-- rest doesn't turn every future Sunday into a rest day. The app only
-- offers this for dates that have already passed; that's a client-side
-- rule, not something this table enforces.

create table public.day_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  status text not null check (status in ('rest', 'missed')),
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

alter table public.day_overrides enable row level security;

create policy "day_overrides_select_own"
  on public.day_overrides for select
  using (auth.uid() = user_id);

create policy "day_overrides_insert_own"
  on public.day_overrides for insert
  with check (auth.uid() = user_id);

create policy "day_overrides_update_own"
  on public.day_overrides for update
  using (auth.uid() = user_id);

create policy "day_overrides_delete_own"
  on public.day_overrides for delete
  using (auth.uid() = user_id);
