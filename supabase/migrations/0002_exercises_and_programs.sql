-- Milestone 3: exercise library + structured program schema.

create type public.exercise_category as enum ('push', 'pull', 'legs', 'core', 'full_body', 'cardio', 'mobility');
create type public.equipment_type as enum ('barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'band', 'other');
create type public.demo_media_type as enum ('video', 'image');
create type public.program_source as enum ('ai_generated', 'manual', 'template');
create type public.program_status as enum ('active', 'completed', 'archived');

-- ---------------------------------------------------------------------------
-- Exercise library
-- ---------------------------------------------------------------------------

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category public.exercise_category not null,
  primary_muscle text not null,
  equipment public.equipment_type not null,
  instructions text,
  demo_media_url text,
  demo_media_type public.demo_media_type,
  is_custom boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index exercises_category_idx on public.exercises (category);
create index exercises_created_by_idx on public.exercises (created_by);

alter table public.exercises enable row level security;

create policy "exercises_select"
  on public.exercises for select
  using (is_custom = false or created_by = auth.uid());

create policy "exercises_insert_own_custom"
  on public.exercises for insert
  with check (is_custom = true and created_by = auth.uid());

create policy "exercises_update_own_custom"
  on public.exercises for update
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy "exercises_delete_own_custom"
  on public.exercises for delete
  using (created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- Programs -> weeks -> days -> exercises
-- ---------------------------------------------------------------------------

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  goal public.training_goal,
  source public.program_source not null default 'manual',
  status public.program_status not null default 'active',
  start_date date not null default current_date,
  weeks_count smallint not null,
  days_per_week smallint not null,
  created_at timestamptz not null default now()
);

create index programs_user_id_idx on public.programs (user_id);

alter table public.programs enable row level security;

create policy "programs_all_own"
  on public.programs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.program_weeks (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  week_number smallint not null,
  focus text,
  deload boolean not null default false,
  unique (program_id, week_number)
);

create index program_weeks_program_id_idx on public.program_weeks (program_id);

alter table public.program_weeks enable row level security;

create policy "program_weeks_all_own"
  on public.program_weeks for all
  using (
    exists (
      select 1 from public.programs p
      where p.id = program_weeks.program_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.programs p
      where p.id = program_weeks.program_id and p.user_id = auth.uid()
    )
  );

create table public.program_days (
  id uuid primary key default gen_random_uuid(),
  program_week_id uuid not null references public.program_weeks (id) on delete cascade,
  day_number smallint not null,
  day_of_week smallint check (day_of_week between 0 and 6),
  title text,
  is_rest_day boolean not null default false,
  unique (program_week_id, day_number)
);

create index program_days_program_week_id_idx on public.program_days (program_week_id);

alter table public.program_days enable row level security;

create policy "program_days_all_own"
  on public.program_days for all
  using (
    exists (
      select 1 from public.program_weeks pw
      join public.programs p on p.id = pw.program_id
      where pw.id = program_days.program_week_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.program_weeks pw
      join public.programs p on p.id = pw.program_id
      where pw.id = program_days.program_week_id and p.user_id = auth.uid()
    )
  );

create table public.program_exercises (
  id uuid primary key default gen_random_uuid(),
  program_day_id uuid not null references public.program_days (id) on delete cascade,
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

create index program_exercises_program_day_id_idx on public.program_exercises (program_day_id);
create index program_exercises_exercise_id_idx on public.program_exercises (exercise_id);

alter table public.program_exercises enable row level security;

create policy "program_exercises_all_own"
  on public.program_exercises for all
  using (
    exists (
      select 1 from public.program_days pd
      join public.program_weeks pw on pw.id = pd.program_week_id
      join public.programs p on p.id = pw.program_id
      where pd.id = program_exercises.program_day_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.program_days pd
      join public.program_weeks pw on pw.id = pd.program_week_id
      join public.programs p on p.id = pw.program_id
      where pd.id = program_exercises.program_day_id and p.user_id = auth.uid()
    )
  );
