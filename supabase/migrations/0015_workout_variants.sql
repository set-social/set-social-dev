-- Milestone 15: adaptive workout variants. Records which variant (if any) a
-- session used — not surfaced anywhere yet (weekly review is a later phase),
-- but cheap to capture now rather than backfill later.

create type public.workout_variant_type as enum (
  'full',
  'time_45',
  'time_30',
  'hotel',
  'home',
  'bodyweight',
  'low_readiness',
  'strength_focus',
  'hypertrophy_focus',
  'reduced_impact'
);

alter table public.workout_logs
  add column variant_type public.workout_variant_type;
