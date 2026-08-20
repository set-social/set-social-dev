import { addDays, format } from 'date-fns';
import { getProgramDayForDate, type ProgramTree } from '../services/api/queries/programs';

export type ScheduledDayWalkEntry = {
  date: Date;
  /** 0 = Sunday .. 6 = Saturday, matching Date#getDay(). */
  weekday: number;
  isTrainingDay: boolean;
  completed: boolean;
};

/**
 * Walks every day in [from, to] (inclusive, capped at today so a future date
 * is never counted as "missed") and resolves whether it was a scheduled,
 * non-rest program training day and whether it was completed. Shared by
 * every consumer that needs "missed program days" so the
 * getProgramDayForDate-per-day loop exists in exactly one place.
 */
export function walkScheduledDays(
  program: ProgramTree | null | undefined,
  completedDates: Set<string>,
  from: Date,
  to: Date,
): ScheduledDayWalkEntry[] {
  const today = new Date();
  const lastDay = to < today ? to : today;
  const entries: ScheduledDayWalkEntry[] = [];

  for (let cursor = new Date(from); cursor <= lastDay; cursor = addDays(cursor, 1)) {
    const resolved = getProgramDayForDate(program, cursor);
    entries.push({
      date: new Date(cursor),
      weekday: cursor.getDay(),
      isTrainingDay: resolved != null && !resolved.day.is_rest_day,
      completed: completedDates.has(format(cursor, 'yyyy-MM-dd')),
    });
  }

  return entries;
}
