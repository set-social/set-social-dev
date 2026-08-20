import type { Database } from '../types/database';
import type { ExerciseMetadata } from '../services/coaching';

type ExerciseRow = Database['public']['Tables']['exercises']['Row'];

/** exercises.category/primary_muscle/secondary_muscles/equipment are all
 * lowercase, underscore-separated enum values in the DB (e.g. "full_body") —
 * this is a display-only transform, never used for comparisons/lookups, so
 * it's safe to apply anywhere one of these is shown as user-facing text. */
export function formatEnumLabel(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function exerciseRowToMetadata(row: ExerciseRow): ExerciseMetadata {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    primaryMuscle: row.primary_muscle,
    secondaryMuscles: row.secondary_muscles,
    equipment: row.equipment,
    movementPattern: row.movement_pattern,
    difficulty: row.difficulty,
    jointStress: row.joint_stress,
    skillRequirement: row.skill_requirement,
  };
}
