-- Milestone 13: live in-workout set recommendations.
-- After a set is logged, the coaching engine may propose one change for the
-- next set (or for the exercise as a whole). Reuses adaptation_source /
-- adaptation_status from migration 0012 — same "who proposed it, what did the
-- user do with it" semantics, just applied to a single set instead of a
-- whole planned workout.

create type public.set_recommendation_type as enum (
  'increase_weight',
  'keep_weight',
  'reduce_weight',
  'increase_rest',
  'stop_exercise',
  'remove_last_set',
  'adjust_reps'
);

create table public.set_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  workout_log_id uuid not null references public.workout_logs (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  after_set_number smallint not null,
  recommendation_type public.set_recommendation_type not null,
  recommended_reps smallint,
  recommended_load_kg numeric(6, 2),
  recommended_rpe numeric(3, 1),
  recommended_rest_seconds smallint,
  reason text not null,
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  source public.adaptation_source not null default 'rule_engine',
  status public.adaptation_status not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index set_recommendations_user_id_idx on public.set_recommendations (user_id);
create index set_recommendations_workout_log_id_idx on public.set_recommendations (workout_log_id);

alter table public.set_recommendations enable row level security;

create policy "set_recommendations_all_own"
  on public.set_recommendations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
