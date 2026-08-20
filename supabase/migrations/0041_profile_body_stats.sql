-- Milestone 41: height and sex, collected during onboarding to personalize
-- AI-generated summaries (e.g. cardio calorie estimates). Private — like
-- birth_date (0033), deliberately not added to public_profiles; nothing
-- outside the owner's own session needs it. Starting weight is NOT stored
-- here — it's seeded into body_metrics instead, the existing weight-over-time
-- table cardio calorie estimates already read the latest entry from.

alter table public.profiles add column if not exists height_cm numeric(5, 1);
alter table public.profiles add column if not exists sex text;

alter table public.profiles drop constraint if exists profiles_sex_check;
alter table public.profiles
  add constraint profiles_sex_check
  check (sex is null or sex in ('male', 'female'));

alter table public.profiles drop constraint if exists profiles_height_cm_check;
alter table public.profiles
  add constraint profiles_height_cm_check
  check (height_cm is null or height_cm > 0);
