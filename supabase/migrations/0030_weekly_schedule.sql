-- Milestone 30: recurring weekly training days — a lightweight day-of-week
-- -> workout_template assignment (e.g. "Wednesday = Ultimate Core Day"),
-- replacing the earlier manual week-based program builder. Deliberately
-- references workout_templates rather than duplicating exercise storage:
-- editing the template updates every future occurrence of that weekday.

create table public.weekly_schedule (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  workout_template_id uuid not null references public.workout_templates (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, day_of_week)
);

create index weekly_schedule_user_id_idx on public.weekly_schedule (user_id);

alter table public.weekly_schedule enable row level security;

create policy "weekly_schedule_all_own"
  on public.weekly_schedule for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
