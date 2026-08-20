-- Milestone 40: Cardio Day — a third day-type alongside Rest and Training on
-- both program_days (AI program) and weekly_schedule (recurring weekday
-- plan). day_type is additive, not a replacement for is_rest_day: is_rest_day
-- is read directly in several places across the app (dayPlan.ts,
-- WeekTimeline, TodayScreen, streak.ts) — rather than touch every call site,
-- the app keeps is_rest_day in sync (is_rest_day = day_type = 'rest') from
-- the one mutation that sets a day's type, so every existing read stays
-- correct without a rewrite.

create type public.day_type as enum ('training', 'rest', 'cardio');

alter table public.program_days add column day_type public.day_type;
update public.program_days set day_type = (case when is_rest_day then 'rest' else 'training' end)::public.day_type;
alter table public.program_days alter column day_type set not null;
alter table public.program_days alter column day_type set default 'training';

-- weekly_schedule previously had no representation of rest/cardio at all —
-- a weekday's absence from this table meant "rest" by omission, and
-- workout_template_id was required on every row. A recurring cardio day has
-- no template to point at, so the column has to go nullable; the check
-- keeps the old guarantee (a training day still needs a template) without
-- constraining the two new day types.
alter table public.weekly_schedule add column day_type public.day_type not null default 'training';
alter table public.weekly_schedule alter column workout_template_id drop not null;
alter table public.weekly_schedule add constraint weekly_schedule_template_required_for_training
  check (day_type <> 'training' or workout_template_id is not null);

-- Cardio sessions reuse workout_logs as their parent record (same
-- started_at/completed_at/notes a strength session already gets) — this
-- table only holds what's actually different: the activity and the inputs
-- the calorie estimate is built from. Deliberately one-shot (started_at and
-- completed_at are both set at save time, not a resumable in-progress row)
-- — see LogCardioScreen; there's no multi-step interior state worth
-- persisting for a single cardio session the way there is for a multi-set
-- strength workout.
create table public.cardio_log_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  workout_log_id uuid not null references public.workout_logs (id) on delete cascade,
  exercise_id uuid references public.exercises (id) on delete set null,
  custom_activity_name text,
  duration_minutes numeric(6,1) not null,
  incline_pct numeric(4,1),
  speed_kmh numeric(5,2),
  distance_km numeric(6,2),
  effort text check (effort in ('easy', 'moderate', 'hard')),
  estimated_calories numeric(7,1) not null,
  created_at timestamptz not null default now(),
  check (exercise_id is not null or custom_activity_name is not null)
);

create index cardio_log_entries_workout_log_id_idx on public.cardio_log_entries (workout_log_id);

alter table public.cardio_log_entries enable row level security;

create policy "cardio_log_entries_all_own"
  on public.cardio_log_entries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Seed activity library — exercise_category already has a 'cardio' value
-- (see 0002), just never populated. custom_activity_name on the log entry
-- itself covers one-off activities not worth adding here permanently.
insert into public.exercises (name, category, primary_muscle, equipment, movement_pattern, default_metric, is_custom)
values
  ('Treadmill', 'cardio', 'cardiovascular', 'machine', 'cardio', 'time', false),
  ('Stationary Bike', 'cardio', 'cardiovascular', 'machine', 'cardio', 'time', false),
  ('Elliptical', 'cardio', 'cardiovascular', 'machine', 'cardio', 'time', false),
  ('Rowing Machine', 'cardio', 'cardiovascular', 'machine', 'cardio', 'time', false),
  ('Stairmaster', 'cardio', 'cardiovascular', 'machine', 'cardio', 'time', false),
  ('Outdoor Run', 'cardio', 'cardiovascular', 'bodyweight', 'cardio', 'time', false),
  ('Outdoor Walk', 'cardio', 'cardiovascular', 'bodyweight', 'cardio', 'time', false),
  ('Swimming', 'cardio', 'cardiovascular', 'other', 'cardio', 'time', false);
