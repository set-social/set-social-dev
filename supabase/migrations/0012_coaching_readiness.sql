-- Milestone 12: AI coaching foundation (readiness check-ins + workout adaptations).
-- Powers the pre-workout readiness score and the rule-based adaptation review shown
-- before starting a scheduled/program-day workout.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.adaptation_type as enum (
  'reduce_sets',
  'reduce_weight',
  'reduce_rpe',
  'increase_rest',
  'swap_exercise',
  'lighter_variation',
  'recovery_replacement',
  'shorten_workout',
  'reschedule'
);

create type public.adaptation_source as enum ('rule_engine', 'ai', 'user');

create type public.adaptation_status as enum ('pending', 'accepted', 'rejected', 'edited');

-- ---------------------------------------------------------------------------
-- readiness_checkins: one user-reported (or partially-skipped) check-in per
-- user per calendar day. resting_heart_rate/hrv_ms/wearable_recovery_score
-- are reserved for a future wearable-sync milestone; they stay null until
-- then, and the coaching engine treats null as "signal unavailable," not 0.
-- ---------------------------------------------------------------------------

create table public.readiness_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  checkin_date date not null,
  sleep_hours numeric(4, 1) check (sleep_hours between 0 and 24),
  sleep_quality smallint check (sleep_quality between 1 and 5),
  soreness smallint check (soreness between 1 and 5),
  stress smallint check (stress between 1 and 5),
  has_pain boolean not null default false,
  pain_notes text,
  resting_heart_rate smallint,
  hrv_ms smallint,
  wearable_recovery_score smallint check (wearable_recovery_score between 0 and 100),
  created_at timestamptz not null default now(),
  unique (user_id, checkin_date)
);

create index readiness_checkins_user_id_idx on public.readiness_checkins (user_id);

alter table public.readiness_checkins enable row level security;

create policy "readiness_checkins_all_own"
  on public.readiness_checkins for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- workout_adaptations: one row per proposed/decided change to a planned
-- workout. Always tied to a program_day or a scheduled_workout (never both
-- null) so the pre-workout review screen can look up "today's adaptations"
-- for whichever source the user is starting from.
-- ---------------------------------------------------------------------------

create table public.workout_adaptations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  program_day_id uuid references public.program_days (id) on delete cascade,
  scheduled_workout_id uuid references public.scheduled_workouts (id) on delete cascade,
  readiness_checkin_id uuid references public.readiness_checkins (id) on delete set null,
  target_exercise_id uuid references public.exercises (id) on delete set null,
  adaptation_type public.adaptation_type not null,
  field_changed text not null,
  original_value jsonb not null,
  updated_value jsonb not null,
  reason text not null,
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  source public.adaptation_source not null default 'rule_engine',
  status public.adaptation_status not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (program_day_id is not null or scheduled_workout_id is not null)
);

create index workout_adaptations_user_id_idx on public.workout_adaptations (user_id);
create index workout_adaptations_program_day_id_idx on public.workout_adaptations (program_day_id);
create index workout_adaptations_scheduled_workout_id_idx on public.workout_adaptations (scheduled_workout_id);

alter table public.workout_adaptations enable row level security;

create policy "workout_adaptations_all_own"
  on public.workout_adaptations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
