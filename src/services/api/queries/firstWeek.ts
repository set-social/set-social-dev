import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import type { Database } from '../../../types/database';
import { getFirstWeekPlan } from '../../../constants/firstWeekSplits';

type ExerciseRow = Database['public']['Tables']['exercises']['Row'];
type TemplateExerciseInsert = Database['public']['Tables']['workout_template_exercises']['Insert'];

/** Beginner-friendly defaults applied to every exercise this generator picks
 * — the same shape TemplateEditorScreen writes, just with fixed values since
 * there's no per-exercise tuning step in this flow. */
const DEFAULT_SETS = 3;
const DEFAULT_REPS_MIN = 8;
const DEFAULT_REPS_MAX = 12;
const DEFAULT_REST_SECONDS = 90;

/** Exercises per generated day — enough for a first workout without being
 * overwhelming, matching what a beginner template typically holds. */
const EXERCISES_PER_DAY = 5;

/** No muscle-group filter exists in the query layer today (fetchExercises in
 * exercises.ts only supports a name search) — this is the one new lookup
 * the "build my first week" generator needs. Plain async function, not a
 * hook, since it's called imperatively inside useBuildFirstWeek's
 * mutationFn rather than rendered. */
export async function fetchExercisesByPrimaryMuscles(muscles: string[]): Promise<ExerciseRow[]> {
  const { data, error } = await supabase
    .from('exercises')
    .select('*')
    .in('primary_muscle', muscles)
    .eq('is_custom', false)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

/** Round-robin across a day's muscle list so a multi-muscle day (e.g.
 * "Chest & Triceps") doesn't end up all one muscle just because it has more
 * seeded exercises than the other. */
async function pickExercisesForDay(primaryMuscles: string[]): Promise<ExerciseRow[]> {
  const buckets = await Promise.all(primaryMuscles.map(muscle => fetchExercisesByPrimaryMuscles([muscle])));

  const picked: ExerciseRow[] = [];
  const seen = new Set<string>();
  for (let round = 0; picked.length < EXERCISES_PER_DAY && buckets.some(b => b.length > round); round += 1) {
    for (const bucket of buckets) {
      if (picked.length >= EXERCISES_PER_DAY) break;
      const candidate = bucket[round];
      if (candidate && !seen.has(candidate.id)) {
        seen.add(candidate.id);
        picked.push(candidate);
      }
    }
  }
  return picked;
}

/**
 * Builds a full first week from the onboarding answers: one workout_template
 * per muscle-group day (deterministically filled from the exercise library,
 * no LLM call), scheduled onto weekly_schedule the same way the manual
 * builder (AssignTrainingDayScreen / useAssignWeeklySchedule) already does.
 */
export function useBuildFirstWeek() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { userId: string; daysPerWeek: number }) => {
      const plan = getFirstWeekPlan(params.daysPerWeek);

      for (const day of plan) {
        const exercises = await pickExercisesForDay(day.primaryMuscles);

        const { data: template, error: templateError } = await supabase
          .from('workout_templates')
          .insert({ user_id: params.userId, name: day.label })
          .select()
          .single();
        if (templateError) throw templateError;

        if (exercises.length > 0) {
          const rows: TemplateExerciseInsert[] = exercises.map((exercise, index) => ({
            workout_template_id: template.id,
            exercise_id: exercise.id,
            order_index: index,
            target_sets: DEFAULT_SETS,
            target_reps_min: DEFAULT_REPS_MIN,
            target_reps_max: DEFAULT_REPS_MAX,
            rest_seconds: DEFAULT_REST_SECONDS,
          }));
          const { error: exercisesError } = await supabase.from('workout_template_exercises').insert(rows);
          if (exercisesError) throw exercisesError;
        }

        const { error: scheduleError } = await supabase
          .from('weekly_schedule')
          .upsert(
            { user_id: params.userId, day_of_week: day.dayOfWeek, workout_template_id: template.id, day_type: 'training' },
            { onConflict: 'user_id,day_of_week' },
          );
        if (scheduleError) throw scheduleError;
      }
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ['weeklySchedule', params.userId] });
      queryClient.invalidateQueries({ queryKey: ['workoutTemplates'] });
    },
  });
}
