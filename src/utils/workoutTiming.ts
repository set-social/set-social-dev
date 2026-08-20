/**
 * Rough estimate only — sets × (rest between sets + ~40s of working time),
 * summed across a workout's exercises. Not stored anywhere, recomputed from
 * real target data each time it's needed. Shared by TodayScreen's day
 * preview and the coaching engine's workout-variant time budgeting, so the
 * two never drift apart on what "45 minutes" actually means.
 */
export function estimateWorkoutMinutes(
  exercises: Array<{ targetSets: number; restSeconds: number | null }>,
): number | null {
  if (exercises.length === 0) return null;
  const totalSeconds = exercises.reduce(
    (sum, e) => sum + e.targetSets * ((e.restSeconds ?? 90) + 40),
    0,
  );
  return Math.max(1, Math.round(totalSeconds / 60));
}
