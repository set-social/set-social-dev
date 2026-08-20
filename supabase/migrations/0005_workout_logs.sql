-- Milestone 4: logged workout sessions and sets.

create table public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  program_day_id uuid references public.program_days (id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text,
  overall_rpe numeric(3, 1)
);

create index workout_logs_user_id_idx on public.workout_logs (user_id);
create index workout_logs_program_day_id_idx on public.workout_logs (program_day_id);

alter table public.workout_logs enable row level security;

create policy "workout_logs_all_own"
  on public.workout_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.workout_log_sets (
  id uuid primary key default gen_random_uuid(),
  workout_log_id uuid not null references public.workout_logs (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  set_number smallint not null,
  reps smallint not null,
  load_kg numeric(6, 2),
  rpe numeric(3, 1),
  is_warmup boolean not null default false,
  completed boolean not null default true,
  logged_at timestamptz not null default now()
);

create index workout_log_sets_workout_log_id_idx on public.workout_log_sets (workout_log_id);
create index workout_log_sets_exercise_user_idx on public.workout_log_sets (exercise_id);

alter table public.workout_log_sets enable row level security;

create policy "workout_log_sets_all_own"
  on public.workout_log_sets for all
  using (
    exists (
      select 1 from public.workout_logs wl
      where wl.id = workout_log_sets.workout_log_id and wl.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.workout_logs wl
      where wl.id = workout_log_sets.workout_log_id and wl.user_id = auth.uid()
    )
  );
