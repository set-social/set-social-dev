-- Coaching History, Phase 1 — see docs/coaching-history.md. Persists exactly
-- the PostWorkoutSummaryResult WorkoutSummaryScreen already computes and
-- shows once, right after a workout — closes docs/ai-coaching.md's "no
-- persisted summary history" gap.
--
-- A dedicated table, not a workout_logs column: every past migration that
-- needed to store a *structured* coaching artifact (workout_adaptations,
-- set_recommendations, exercise_substitutions, training_patterns) used its
-- own table FK'd back to workout_logs/program_days — that's the dominant
-- precedent here, not workout_logs' one scalar-column addition
-- (variant_type, a single enum, not a structured payload). workout_logs
-- has never held a jsonb column.
--
-- user_id is denormalized (present directly, not only reachable via
-- workout_log_id -> workout_logs.user_id) because this table is read
-- standalone ("show me my coaching history"), unlike workout_log_sets
-- (the one table in this schema that omits user_id, precisely because it's
-- never read standalone, always joined through workout_logs).

create table public.coaching_summaries (
  id uuid primary key default gen_random_uuid(),
  workout_log_id uuid not null unique references public.workout_logs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  summary jsonb not null,
  created_at timestamptz not null default now()
);

-- Read standalone, newest first, for the CoachingHistoryScreen list.
create index coaching_summaries_user_id_created_at_idx
  on public.coaching_summaries (user_id, created_at desc);

alter table public.coaching_summaries enable row level security;

create policy "coaching_summaries_all_own"
  on public.coaching_summaries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
