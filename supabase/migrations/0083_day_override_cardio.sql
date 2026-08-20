-- Milestone 83: 'cardio' as a third day_overrides status, alongside the
-- existing 'rest'/'missed' (0054). Lets an athlete mark a single current
-- or future date as a cardio day without touching the recurring
-- weekly_schedule/program row for that weekday — the same "override just
-- this date" contract 'rest'/'missed' already have, extended to cover
-- "make this a cardio day" (CalendarScreen's sheets), not just "this
-- isn't happening." Precedence is unchanged: day_overrides is still
-- checked ahead of scheduled_workouts/weekly_schedule/program_days in
-- resolveDayPlan (dayPlan.ts), so a 'cardio' override wins over whatever
-- was on the date before, the same way 'rest'/'missed' already do.

alter table public.day_overrides drop constraint if exists day_overrides_status_check;
alter table public.day_overrides add constraint day_overrides_status_check
  check (status in ('rest', 'missed', 'cardio'));
