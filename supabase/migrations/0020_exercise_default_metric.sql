-- Milestone 20: user-created custom exercises need to remember which unit
-- they're tracked in (weight vs. reps-only vs. time) since, unlike the
-- curated library, there's no way to infer it from the exercise itself.
-- Nullable — existing rows and library exercises fall back to the logger's
-- weight-unit preference exactly like before this column existed.

alter table public.exercises
  add column default_metric text
  check (default_metric in ('weight_lb', 'weight_kg', 'weight_pct', 'reps', 'time'));
