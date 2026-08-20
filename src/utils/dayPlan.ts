import { format } from 'date-fns';
import {
  getProgramDayForDate,
  type ProgramTree,
  type ProgramWeekWithDays,
  type ProgramDayWithExercises,
} from '../services/api/queries/programs';
import { getWeeklyScheduleForDate, type WeeklyScheduleEntry } from '../services/api/queries/weeklySchedule';
import { getDayOverrideForDate, type DayOverride } from '../services/api/queries/dayOverrides';
import type { WorkoutLogSummary } from '../services/api/queries/workoutLogs';
import type { Database } from '../types/database';

export type ScheduledWorkoutLike = Pick<
  Database['public']['Tables']['scheduled_workouts']['Row'],
  'id' | 'name' | 'scheduled_date'
>;

export type ResolvedDayPlan =
  | { kind: 'completed'; title: string | null; workoutLogIds: string[] }
  | { kind: 'scheduled'; scheduledWorkout: ScheduledWorkoutLike }
  | { kind: 'weeklyRecurring'; entry: WeeklyScheduleEntry }
  | { kind: 'weeklyCardio'; entry: WeeklyScheduleEntry }
  | { kind: 'programRest'; week: ProgramWeekWithDays; day: ProgramDayWithExercises }
  | { kind: 'programTraining'; week: ProgramWeekWithDays; day: ProgramDayWithExercises }
  | { kind: 'programCardio'; week: ProgramWeekWithDays; day: ProgramDayWithExercises }
  | { kind: 'overrideRest' }
  | { kind: 'overrideCardio' }
  | { kind: 'missed' }
  | { kind: 'none' };

function dateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Single source of truth for "what's the plan for this date" — replaces
 * three screens (Today, Training, Log) that used to answer this question
 * independently, with two different precedence orders between them.
 * Precedence: a completed workout always wins, then an ad-hoc schedule
 * override, then the recurring weekly template, then the active program's
 * day for that date.
 */
export function resolveDayPlan(params: {
  date: Date;
  program: ProgramTree | null | undefined;
  weeklySchedule: WeeklyScheduleEntry[] | null | undefined;
  scheduledWorkouts: ScheduledWorkoutLike[] | null | undefined;
  workoutLogs: WorkoutLogSummary[] | null | undefined;
  dayOverrides?: DayOverride[] | null;
}): ResolvedDayPlan {
  const { date, program, weeklySchedule, scheduledWorkouts, workoutLogs, dayOverrides } = params;
  const key = dateKey(date);

  const scheduled = (scheduledWorkouts ?? []).find(sw => sw.scheduled_date === key) ?? null;
  const weeklyEntry = getWeeklyScheduleForDate(weeklySchedule, date);
  const programResolved = getProgramDayForDate(program, date);

  const workoutLogIds = (workoutLogs ?? [])
    .filter(log => dateKey(new Date(log.completedAt)) === key)
    .map(log => log.id);

  if (workoutLogIds.length > 0) {
    const title = scheduled?.name ?? weeklyEntry?.workout_templates?.name ?? programResolved?.day.title ?? null;
    return { kind: 'completed', title, workoutLogIds };
  }

  // A completed log always wins over an override (logging the workout after
  // marking the day rest/missed should just show as done) — everything else
  // (the recurring weekly template, the active program's day, an ad-hoc
  // schedule) is a *plan* for the date, and an override is the athlete
  // overruling that plan for this one date specifically.
  const override = getDayOverrideForDate(dayOverrides, date);
  if (override) {
    if (override.status === 'missed') return { kind: 'missed' };
    if (override.status === 'cardio') return { kind: 'overrideCardio' };
    return { kind: 'overrideRest' };
  }

  if (scheduled) return { kind: 'scheduled', scheduledWorkout: scheduled };
  if (weeklyEntry) {
    return weeklyEntry.day_type === 'cardio'
      ? { kind: 'weeklyCardio', entry: weeklyEntry }
      : { kind: 'weeklyRecurring', entry: weeklyEntry };
  }
  if (programResolved) {
    const { week, day } = programResolved;
    // day_type is the source of truth (is_rest_day is kept in sync by
    // useSetDayType purely for older direct-boolean readers elsewhere) —
    // falls back to is_rest_day when day_type is absent (older test
    // fixtures/mocks predating this column; real rows are NOT NULL).
    const dayType = day.day_type ?? (day.is_rest_day ? 'rest' : 'training');
    if (dayType === 'cardio') return { kind: 'programCardio', week, day };
    if (dayType === 'rest') return { kind: 'programRest', week, day };
    return { kind: 'programTraining', week, day };
  }
  return { kind: 'none' };
}

/**
 * A weekday row shows a "one-off" badge only when an ad-hoc scheduled
 * workout overrides that day — not when the active program's day disagrees
 * with the recurring weekly-schedule baseline (two independent recurring
 * systems disagreeing isn't a "just this week" exception). Caller passes
 * the same date's `getWeeklyScheduleForDate` result as the baseline.
 */
export function getOneOffBaseline(
  resolved: ResolvedDayPlan,
  weeklyBaseline: WeeklyScheduleEntry | null,
): string | null {
  if (resolved.kind !== 'scheduled') return null;
  if (!weeklyBaseline) return 'Rest';
  if (weeklyBaseline.day_type === 'cardio') return 'Cardio Day';
  return weeklyBaseline.workout_templates?.name ?? 'Rest';
}
