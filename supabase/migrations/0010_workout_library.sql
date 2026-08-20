-- Milestone 10: workout library (reusable templates + calendar-scheduled instances).

-- ---------------------------------------------------------------------------
-- workout_templates: a user-owned, reusable workout definition.
-- ---------------------------------------------------------------------------

create table public.workout_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  notes text,
  estimated_duration_minutes smallint,
  source_program_day_id uuid references public.program_days (id) on delete set null,
  created_at timestamptz not null default now()
);

create index workout_templates_user_id_idx on public.workout_templates (user_id);
create index workout_templates_source_program_day_id_idx on public.workout_templates (source_program_day_id);

alter table public.workout_templates enable row level security;

create policy "workout_templates_all_own"
  on public.workout_templates for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- workout_template_exercises: mirrors program_exercises' target-column shape.
-- ---------------------------------------------------------------------------

create table public.workout_template_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_template_id uuid not null references public.workout_templates (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  order_index smallint not null default 0,
  target_sets smallint not null,
  target_reps_min smallint,
  target_reps_max smallint,
  target_load_kg numeric(6, 2),
  target_rpe numeric(3, 1),
  rest_seconds smallint,
  notes text
);

create index workout_template_exercises_template_id_idx on public.workout_template_exercises (workout_template_id);
create index workout_template_exercises_exercise_id_idx on public.workout_template_exercises (exercise_id);

alter table public.workout_template_exercises enable row level security;

create policy "workout_template_exercises_all_own"
  on public.workout_template_exercises for all
  using (
    exists (
      select 1 from public.workout_templates wt
      where wt.id = workout_template_exercises.workout_template_id and wt.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.workout_templates wt
      where wt.id = workout_template_exercises.workout_template_id and wt.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- scheduled_workouts: an independent, date-placed copy of a template. Never
-- mutated by later template edits — source_template_id is provenance only.
-- ---------------------------------------------------------------------------

create table public.scheduled_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  scheduled_date date not null,
  name text not null,
  notes text,
  source_template_id uuid references public.workout_templates (id) on delete set null,
  created_at timestamptz not null default now()
);

create index scheduled_workouts_user_id_idx on public.scheduled_workouts (user_id);
create index scheduled_workouts_scheduled_date_idx on public.scheduled_workouts (scheduled_date);
create index scheduled_workouts_source_template_id_idx on public.scheduled_workouts (source_template_id);

alter table public.scheduled_workouts enable row level security;

create policy "scheduled_workouts_all_own"
  on public.scheduled_workouts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- scheduled_workout_exercises: the scheduled workout's own independent copy.
-- ---------------------------------------------------------------------------

create table public.scheduled_workout_exercises (
  id uuid primary key default gen_random_uuid(),
  scheduled_workout_id uuid not null references public.scheduled_workouts (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  order_index smallint not null default 0,
  target_sets smallint not null,
  target_reps_min smallint,
  target_reps_max smallint,
  target_load_kg numeric(6, 2),
  target_rpe numeric(3, 1),
  rest_seconds smallint,
  notes text
);

create index scheduled_workout_exercises_scheduled_workout_id_idx on public.scheduled_workout_exercises (scheduled_workout_id);
create index scheduled_workout_exercises_exercise_id_idx on public.scheduled_workout_exercises (exercise_id);

alter table public.scheduled_workout_exercises enable row level security;

create policy "scheduled_workout_exercises_all_own"
  on public.scheduled_workout_exercises for all
  using (
    exists (
      select 1 from public.scheduled_workouts sw
      where sw.id = scheduled_workout_exercises.scheduled_workout_id and sw.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.scheduled_workouts sw
      where sw.id = scheduled_workout_exercises.scheduled_workout_id and sw.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- workout_logs: trace a completed/in-progress session back to the scheduled
-- item it fulfilled (nullable, additive — existing rows/queries untouched).
-- Must come after scheduled_workouts exists, for the FK.
-- ---------------------------------------------------------------------------

alter table public.workout_logs
  add column scheduled_workout_id uuid references public.scheduled_workouts (id) on delete set null;

create index workout_logs_scheduled_workout_id_idx on public.workout_logs (scheduled_workout_id);

-- ---------------------------------------------------------------------------
-- profiles: new signups default to lb; existing users' stored preference is
-- left untouched (no UPDATE statement here on purpose).
-- ---------------------------------------------------------------------------

alter table public.profiles
  alter column unit_preference set default 'lb';
