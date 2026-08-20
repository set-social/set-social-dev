import { format } from 'date-fns';
import { getProgramDayForDate, type ProgramTree } from '../services/api/queries/programs';
import { getWeeklyScheduleForDate, type WeeklyScheduleEntry } from '../services/api/queries/weeklySchedule';

const MAX_LOOKBACK_DAYS = 90;

/** A rest day counts toward the streak the same as a completed day — the
 * point of a streak is "are you keeping up with what you actually planned,"
 * and a planned rest day is being kept up with by definition, not a gap in
 * it. Only fires when there's real evidence of a plan (an active program or
 * at least one weekly_schedule entry) — with neither, every day would
 * trivially resolve "no plan for this day" and the streak would run all 90
 * lookback days for a user who's never set anything up at all. */
function isRestDay(
  program: ProgramTree | null | undefined,
  weeklySchedule: WeeklyScheduleEntry[] | null | undefined,
  date: Date,
): boolean {
  const hasAnyPlan = program != null || (weeklySchedule != null && weeklySchedule.length > 0);
  if (!hasAnyPlan) return false;
  const resolved = getProgramDayForDate(program, date);
  const hasWeeklyPlan = getWeeklyScheduleForDate(weeklySchedule, date) != null;
  return (!resolved || resolved.day.is_rest_day) && !hasWeeklyPlan;
}

function countsForStreak(
  program: ProgramTree | null | undefined,
  completedDates: Set<string>,
  weeklySchedule: WeeklyScheduleEntry[] | null | undefined,
  date: Date,
): boolean {
  return completedDates.has(format(date, 'yyyy-MM-dd')) || isRestDay(program, weeklySchedule, date);
}

/**
 * Consecutive-day streak ending today, walking backward. A rest day —
 * either no active-program obligation for that date, or no recurring
 * weekly_schedule assignment for that weekday — counts toward the streak
 * exactly like a completed day; only a day that actually had a plan and
 * wasn't completed breaks it. Today itself only counts once it's completed
 * (or if today itself resolves as rest) — an unfinished "today" with a real
 * plan pending doesn't retroactively break yesterday's streak, it just
 * isn't added yet. Capped at a 90-day lookback so a very long streak still
 * resolves in bounded time; callers can display "90+" at the cap.
 *
 * A day counts as non-rest if either the AI program resolves a training day
 * or a recurring weekly_schedule assignment exists for that weekday — most
 * users have no active program, so relying on `program` alone would leave
 * their streak blind to every missed recurring day.
 */
export function computeStreak(
  program: ProgramTree | null | undefined,
  completedDates: Set<string>,
  today: Date = new Date(),
  weeklySchedule?: WeeklyScheduleEntry[] | null,
): number {
  let streak = countsForStreak(program, completedDates, weeklySchedule, today) ? 1 : 0;

  const cursor = new Date(today);
  cursor.setDate(cursor.getDate() - 1);

  for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
    if (countsForStreak(program, completedDates, weeklySchedule, cursor)) {
      streak++;
    } else {
      break;
    }
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}
