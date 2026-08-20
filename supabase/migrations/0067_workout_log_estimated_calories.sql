-- Strength sessions had no per-session calorie estimate of their own — Energy
-- Today's "workout" burn for a lifting day fell back to a flat duration-only
-- guess (see energyBalance.ts). Cardio sessions already persist a real
-- per-activity estimate on cardio_log_entries.estimated_calories; this adds
-- the equivalent column directly on workout_logs so a strength session's own
-- estimate (computed once at completion time, from the athlete's body stats
-- and this session's actual volume — see WorkoutSummaryScreen) can be
-- persisted and reused as-is everywhere that session's burn is counted,
-- instead of re-derived differently in different places.

alter table public.workout_logs
  add column estimated_calories integer;
