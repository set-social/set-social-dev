/** The full, real set of distinct `exercises.primary_muscle` values in the
 * seeded catalog (see supabase/migrations/0003_seed_exercises.sql and
 * 0034_seed_exercise_library_expansion.sql) — used to offer emphasis choices
 * the generator can actually act on, not a list invented for this picker. */
export const MUSCLE_GROUPS = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'core',
  'obliques',
  'quadriceps',
  'hamstrings',
  'glutes',
  'calves',
  'full_body',
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];
