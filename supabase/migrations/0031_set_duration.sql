-- Milestone 31: "Timer" is now a real set-tracking metric (a timed hold,
-- e.g. a plank), not just a disabled option. Stored in its own column
-- rather than reusing load_kg — nothing on this table records which metric
-- produced a given row, so a repurposed load_kg would be indistinguishable
-- from an actual weight and would silently corrupt volume/PR math. Nullable:
-- only populated for time-metric sets, null otherwise.

alter table public.workout_log_sets
  add column duration_seconds smallint;
