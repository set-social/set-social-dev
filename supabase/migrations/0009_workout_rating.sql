-- Session-based workout flow: a 1-5 subjective "how did it feel" rating,
-- captured on the new Workout Summary screen alongside the existing
-- overall_rpe (performance) and notes fields.

alter table public.workout_logs
  add column rating smallint check (rating between 1 and 5);
