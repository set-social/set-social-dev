/**
 * Data for the onboarding "build my first week" offer (BuildFirstWeekScreen):
 * given the days-per-week the user already chose on DaysPerWeekScreen
 * (options are hardcoded to 2-6 there, so only those keys are defined here),
 * which weekday each training day lands on and which muscle group it targets.
 */

/**
 * Which day-of-week slots (0 = Sunday, matching Date.getDay() — the same
 * convention weekly_schedule.day_of_week and AssignTrainingDayScreen already
 * use) get a training day for a given days-per-week count. Copied verbatim
 * from supabase/functions/generate-program/index.ts's WEEKDAY_PATTERNS —
 * duplicated rather than shared because that function runs in Deno and this
 * runs in the RN app, with no shared package between the two today.
 */
export const WEEKDAY_PATTERNS: Record<number, number[]> = {
  1: [3],
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
  6: [1, 2, 3, 4, 5, 6],
  7: [0, 1, 2, 3, 4, 5, 6],
};

export type MuscleGroupDay = {
  label: string;
  /** Filters exercises.primary_muscle — values match what's actually seeded
   * (see supabase/migrations/0034_seed_exercise_library_expansion.sql). */
  primaryMuscles: string[];
};

/**
 * One entry per days-per-week option DaysPerWeekScreen exposes (2-6). Each
 * list's length equals its key and no muscle group repeats within a list —
 * shorter weeks collapse toward classic splits (Upper/Lower, Push/Pull/Legs)
 * rather than shrinking the 6-day list from the middle.
 */
export const MUSCLE_GROUP_SPLITS: Record<number, MuscleGroupDay[]> = {
  2: [
    { label: 'Upper Body', primaryMuscles: ['chest', 'back', 'shoulders', 'biceps', 'triceps'] },
    { label: 'Lower Body', primaryMuscles: ['quadriceps', 'hamstrings', 'glutes', 'calves'] },
  ],
  3: [
    { label: 'Push', primaryMuscles: ['chest', 'shoulders', 'triceps'] },
    { label: 'Pull', primaryMuscles: ['back', 'biceps'] },
    { label: 'Legs', primaryMuscles: ['quadriceps', 'hamstrings', 'glutes', 'calves'] },
  ],
  4: [
    { label: 'Chest & Triceps', primaryMuscles: ['chest', 'triceps'] },
    { label: 'Back & Biceps', primaryMuscles: ['back', 'biceps'] },
    { label: 'Legs', primaryMuscles: ['quadriceps', 'hamstrings', 'glutes', 'calves'] },
    { label: 'Shoulders & Core', primaryMuscles: ['shoulders', 'core', 'obliques'] },
  ],
  5: [
    { label: 'Chest', primaryMuscles: ['chest'] },
    { label: 'Back', primaryMuscles: ['back'] },
    { label: 'Legs', primaryMuscles: ['quadriceps', 'hamstrings', 'glutes', 'calves'] },
    { label: 'Shoulders', primaryMuscles: ['shoulders'] },
    { label: 'Arms', primaryMuscles: ['biceps', 'triceps'] },
  ],
  6: [
    { label: 'Chest & Triceps', primaryMuscles: ['chest', 'triceps'] },
    { label: 'Back & Biceps', primaryMuscles: ['back', 'biceps'] },
    { label: 'Legs', primaryMuscles: ['quadriceps', 'calves'] },
    { label: 'Shoulders', primaryMuscles: ['shoulders'] },
    { label: 'Arms', primaryMuscles: ['biceps', 'triceps'] },
    { label: 'Core & Glutes', primaryMuscles: ['core', 'obliques', 'glutes'] },
  ],
};

export type FirstWeekDayPlan = MuscleGroupDay & { dayOfWeek: number };

/** Pairs WEEKDAY_PATTERNS with MUSCLE_GROUP_SPLITS by index for a given
 * days-per-week count, in calendar order (Sunday first). */
export function getFirstWeekPlan(daysPerWeek: number): FirstWeekDayPlan[] {
  const weekdays = WEEKDAY_PATTERNS[daysPerWeek];
  const muscleDays = MUSCLE_GROUP_SPLITS[daysPerWeek];
  return muscleDays.map((day, index) => ({ ...day, dayOfWeek: weekdays[index] }));
}
