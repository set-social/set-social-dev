import type { Database } from '../types/database';
import type { VariantSourceExercise } from '../services/coaching';
import { exerciseRowToMetadata } from './exerciseMetadata';

type ExerciseRow = Database['public']['Tables']['exercises']['Row'];

/** program_exercises / scheduled_workout_exercises rows share this shape. */
export type VariantTargetRow = {
  exercises: { id: string };
  target_sets: number;
  target_reps_min: number | null;
  target_reps_max: number | null;
  target_load_kg: number | null;
  target_rpe: number | null;
  rest_seconds: number | null;
};

/** Merges target rows with the full exercise library by id, so the coaching
 * engine's variant generator has the movement-pattern/equipment/joint-stress
 * metadata it needs (the nested query on targets only selects a few display
 * columns, not the full exercise row). Silently drops a target whose
 * exercise can't be found in the library — shouldn't happen in practice. */
export function buildVariantSourceExercises(
  targets: VariantTargetRow[],
  exerciseLibrary: ExerciseRow[],
): VariantSourceExercise[] {
  const byId = new Map(exerciseLibrary.map(row => [row.id, row]));
  const result: VariantSourceExercise[] = [];
  for (const t of targets) {
    const row = byId.get(t.exercises.id);
    if (!row) continue;
    result.push({
      metadata: exerciseRowToMetadata(row),
      target: {
        exerciseId: row.id,
        targetSets: t.target_sets,
        targetRepsMin: t.target_reps_min,
        targetRepsMax: t.target_reps_max,
        targetLoadKg: t.target_load_kg,
        targetRpe: t.target_rpe,
        restSeconds: t.rest_seconds,
      },
    });
  }
  return result;
}
