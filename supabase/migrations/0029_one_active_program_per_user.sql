-- Milestone 29: enforce at most one active program per user at the DB
-- level. Program generation/creation is becoming a repeatable, user-
-- triggered action (previously it only ever ran once, atomically tied to
-- finishing onboarding) - an archive-then-insert convention in application
-- code alone is a TOCTOU race (two near-simultaneous calls can each find
-- zero active rows to archive, then each insert a new active row). This
-- index turns that race into a clean, catchable unique-violation instead of
-- silently producing two active programs, which every query assuming
-- exactly one (e.g. useActiveProgramTree) depends on.

create unique index programs_one_active_per_user_idx
  on public.programs (user_id) where status = 'active';
