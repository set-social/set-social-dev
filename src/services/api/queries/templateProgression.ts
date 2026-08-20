import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { fetchWorkoutTemplate, updateTemplateExercise, type TemplateExerciseWithExercise } from './workoutTemplates';
import type { ActiveExercise, LoggedSet, SetMetric, WorkoutSource } from '../../../store/activeWorkoutStore';
import type { Database } from '../../../types/database';

type TemplateExerciseUpdate = Database['public']['Tables']['workout_template_exercises']['Update'];
type TemplateExerciseTarget = Pick<
  TemplateExerciseWithExercise,
  'target_sets' | 'target_reps_min' | 'target_reps_max' | 'target_load_kg'
>;

/**
 * Computes what (if anything) about a template exercise's targets should
 * change to match what was actually completed this session — the pure core
 * of the post-workout sync, split out for unit testing without a live
 * Supabase client (same pattern as workoutShares.ts's toSnapshot).
 *
 * Every field is derived independently and only from sets that actually
 * carry a usable value for it — never overwriting with a number derived
 * from nothing. `target_load_kg` is additionally gated on `metric`: a
 * session's `loadKg` column is reused as a raw storage slot for
 * weight_pct/reps/time metrics too (same reasoning this codebase already
 * applied when duration tracking was added — writing a percentage or a
 * duration into a column that's supposed to always mean real kilograms
 * would silently corrupt it), so load only ever syncs for an
 * actually-weight-tracked exercise.
 *
 * Returns `null` when nothing about the target actually changed.
 */
export function computeSyncedTarget(
  existing: TemplateExerciseTarget,
  metric: SetMetric,
  completedSets: LoggedSet[],
): TemplateExerciseUpdate | null {
  const patch: TemplateExerciseUpdate = {};

  const targetSets = completedSets.length;
  if (targetSets !== existing.target_sets) patch.target_sets = targetSets;

  const reps = completedSets.map(s => s.reps).filter((r): r is number => r != null);
  if (reps.length > 0) {
    const repsMin = Math.min(...reps);
    const repsMax = Math.max(...reps);
    if (repsMin !== existing.target_reps_min) patch.target_reps_min = repsMin;
    if (repsMax !== existing.target_reps_max) patch.target_reps_max = repsMax;
  }

  if (metric === 'weight_kg' || metric === 'weight_lb') {
    const loads = completedSets.map(s => s.loadKg).filter((l): l is number => l != null);
    if (loads.length > 0) {
      const loadKg = Math.max(...loads);
      if (loadKg !== existing.target_load_kg) patch.target_load_kg = loadKg;
    }
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

/** Resolves a completed session's `WorkoutSource` down to the recurring
 * template it should sync back into, or `null` when there isn't one:
 * AI program days and freestyle sessions are excluded entirely (a program
 * week's targets are deliberately AI-authored per-week progression, not a
 * copy that should get silently overwritten); a `scheduledWorkout` session
 * only has one when it was actually started from a template (`Start
 * Workout` on a weekly-recurring day) rather than an ad-hoc one-off, so
 * `source_template_id` being null there means "nothing to sync to," not an
 * error. `'template'` is handled directly (no lookup needed) for
 * completeness against the WorkoutSource union, even though no current
 * navigation entry point ever produces that source type. */
async function resolveTemplateId(source: WorkoutSource | null): Promise<string | null> {
  if (!source) return null;
  switch (source.type) {
    case 'template':
      return source.id;
    case 'scheduledWorkout': {
      const { data, error } = await supabase
        .from('scheduled_workouts')
        .select('source_template_id')
        .eq('id', source.id)
        .single();
      if (error) throw error;
      return data.source_template_id;
    }
    case 'programDay':
    case 'freestyle':
      return null;
  }
}

/**
 * "Tuesday's arm day gets an extra set → next Tuesday's arm day should
 * have it too." Fires once, right after a workout is marked complete
 * (WorkoutSummaryScreen — the only place a session ever finishes), and
 * writes the actually-completed set count/rep range/working weight back
 * into the template each exercise came from. Silent by design: this is a
 * background enhancement layered on an already-successful save, so a
 * failure here is logged and swallowed rather than surfaced — it must
 * never block leaving the summary screen or read as an error for a workout
 * the athlete already saw save successfully.
 */
export function useSyncCompletedWorkoutToTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { source: WorkoutSource | null; exercises: ActiveExercise[] }) => {
      try {
        const templateId = await resolveTemplateId(params.source);
        if (!templateId) return { templateId: null };

        const template = await fetchWorkoutTemplate(templateId);
        const templateExerciseByExerciseId = new Map(
          template.workout_template_exercises.map(te => [te.exercise_id, te]),
        );

        const updates: Array<{ id: string } & TemplateExerciseUpdate> = [];
        for (const exercise of params.exercises) {
          const templateExercise = templateExerciseByExerciseId.get(exercise.exerciseId);
          if (!templateExercise) continue; // substituted/added mid-session — not part of the recurring plan

          const completedSets = exercise.sets.filter(s => s.completed && !s.isWarmup);
          if (completedSets.length === 0) continue; // skipped this session — plan stays as-is, not removed

          const patch = computeSyncedTarget(templateExercise, exercise.metric, completedSets);
          if (patch) updates.push({ id: templateExercise.id, ...patch });
        }

        await Promise.all(updates.map(update => updateTemplateExercise(update)));
        return { templateId };
      } catch (err) {
        console.error('useSyncCompletedWorkoutToTemplate failed', err);
        return { templateId: null };
      }
    },
    onSuccess: ({ templateId }) => {
      if (!templateId) return;
      queryClient.invalidateQueries({ queryKey: ['workoutTemplate', templateId] });
      queryClient.invalidateQueries({ queryKey: ['workoutTemplates'] });
    },
  });
}
