-- Milestone 64: meal skipping + a dedicated meal-reminder push toggle.
--
-- Skipping a meal reuses food_log_entries (a new 'skipped' status) rather
-- than a separate table - the same "is this meal slot accounted for"
-- question the meal-gap nudge and Home already ask of a real entry, just
-- with zero calories and never counted toward a total (every totals query
-- already filters to status = 'confirmed', so 'skipped' rows are excluded
-- for free).
--
-- push_meal_reminders_enabled is a sub-toggle under the existing "Arnold"
-- push category (push_ai_coach_enabled, 0043_push_notifications.sql) -
-- send-push checks both, same "master + per-type" pattern most push
-- clients use.

alter type public.food_log_status add value 'skipped';

alter table public.profiles
  add column push_meal_reminders_enabled boolean not null default true;
