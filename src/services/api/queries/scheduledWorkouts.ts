import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '../supabaseClient';
import type { Database } from '../../../types/database';
import type { WorkoutTemplateTree } from './workoutTemplates';

type ScheduledWorkoutRow = Database['public']['Tables']['scheduled_workouts']['Row'];
type ScheduledExerciseRow = Database['public']['Tables']['scheduled_workout_exercises']['Row'];
type ExerciseRow = Database['public']['Tables']['exercises']['Row'];

// TodayScreen's paging/prefetch window — kept here (rather than duplicated
// per-caller) so anything that needs to match its ['scheduledWorkouts', ...]
// cache key exactly, like useAppBootstrap's splash-time prefetch, can't drift
// out of sync with it.
export const TODAY_RANGE_PAST_DAYS = 91; // ~13 weeks, matches WeekTimeline's paging window
export const TODAY_RANGE_FUTURE_DAYS = 21;

/** Common shape shared by program_exercises / workout_template_exercises rows
 * — anything with this shape can be copied into a scheduled workout. */
export type ScheduleExerciseInput = {
  exercise_id: string;
  order_index: number;
  target_sets: number;
  target_reps_min: number | null;
  target_reps_max: number | null;
  target_load_kg: number | null;
  target_rpe: number | null;
  rest_seconds: number | null;
  notes: string | null;
};

export type ScheduledExerciseWithExercise = ScheduledExerciseRow & {
  exercises: Pick<ExerciseRow, 'id' | 'name' | 'category' | 'primary_muscle'>;
};
export type ScheduledWorkoutTree = ScheduledWorkoutRow & {
  scheduled_workout_exercises: ScheduledExerciseWithExercise[];
};

export async function fetchScheduledWorkouts(
  userId: string,
  from: string,
  to: string,
): Promise<ScheduledWorkoutRow[]> {
  const { data, error } = await supabase
    .from('scheduled_workouts')
    .select('*')
    .eq('user_id', userId)
    .gte('scheduled_date', from)
    .lte('scheduled_date', to)
    .order('scheduled_date');

  if (error) throw error;
  return data;
}

export function useScheduledWorkouts(userId: string | null, range: { from: string; to: string }) {
  return useQuery({
    queryKey: ['scheduledWorkouts', userId, range.from, range.to],
    queryFn: () => fetchScheduledWorkouts(userId as string, range.from, range.to),
    enabled: userId != null,
  });
}

async function fetchScheduledWorkout(scheduledWorkoutId: string): Promise<ScheduledWorkoutTree> {
  const { data, error } = await supabase
    .from('scheduled_workouts')
    .select(
      `*,
      scheduled_workout_exercises (
        *,
        exercises ( id, name, category, primary_muscle )
      )`,
    )
    .eq('id', scheduledWorkoutId)
    .order('order_index', { foreignTable: 'scheduled_workout_exercises' })
    .single();

  if (error) throw error;
  return data as ScheduledWorkoutTree;
}

export function useScheduledWorkout(scheduledWorkoutId: string | undefined) {
  return useQuery({
    queryKey: ['scheduledWorkout', scheduledWorkoutId],
    queryFn: () => fetchScheduledWorkout(scheduledWorkoutId as string),
    enabled: scheduledWorkoutId != null,
  });
}

/** The independent-copy operation — the scheduled workout gets its own
 * exercise rows, never a reference back to the source template/program day.
 * Works from either source since both share the same target-column shape. */
export function useCreateScheduledWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      userId: string;
      scheduledDate: string;
      name: string;
      sourceTemplateId?: string | null;
      exercises: ScheduleExerciseInput[];
    }) => {
      const insert: Database['public']['Tables']['scheduled_workouts']['Insert'] = {
        user_id: params.userId,
        scheduled_date: params.scheduledDate,
        name: params.name,
        source_template_id: params.sourceTemplateId ?? null,
      };
      const { data: scheduled, error } = await supabase
        .from('scheduled_workouts')
        .insert(insert)
        .select()
        .single();
      if (error) throw error;

      if (params.exercises.length > 0) {
        const rows: Database['public']['Tables']['scheduled_workout_exercises']['Insert'][] =
          params.exercises.map(ex => ({
            scheduled_workout_id: scheduled.id,
            exercise_id: ex.exercise_id,
            order_index: ex.order_index,
            target_sets: ex.target_sets,
            target_reps_min: ex.target_reps_min,
            target_reps_max: ex.target_reps_max,
            target_load_kg: ex.target_load_kg,
            target_rpe: ex.target_rpe,
            rest_seconds: ex.rest_seconds,
            notes: ex.notes,
          }));
        const { error: exercisesError } = await supabase.from('scheduled_workout_exercises').insert(rows);
        if (exercisesError) throw exercisesError;
      }
      return scheduled;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduledWorkouts'] });
    },
  });
}

/** Materializes "today's instance" of a recurring weekly-schedule day as a
 * real, startable scheduled_workouts row. Find-or-create, not unconditional
 * create — scheduled_workouts has no unique constraint on
 * (user_id, scheduled_date), so repeatedly tapping "Start Workout" the same
 * day (e.g. backing out of an unfinished session and retrying) would
 * otherwise insert a duplicate row every time, and a duplicate workout_logs
 * row along with it once started. */
export function useStartTemplateToday() {
  const queryClient = useQueryClient();
  const createScheduledWorkout = useCreateScheduledWorkout();
  return useMutation({
    mutationFn: async (params: { userId: string; template: WorkoutTemplateTree }) => {
      const today = format(new Date(), 'yyyy-MM-dd');
      const { data: existing, error } = await supabase
        .from('scheduled_workouts')
        .select('*')
        .eq('user_id', params.userId)
        .eq('scheduled_date', today)
        .eq('source_template_id', params.template.id)
        .maybeSingle();
      if (error) throw error;
      if (existing) return existing;

      return createScheduledWorkout.mutateAsync({
        userId: params.userId,
        scheduledDate: today,
        name: params.template.name,
        sourceTemplateId: params.template.id,
        exercises: params.template.workout_template_exercises,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduledWorkouts'] });
    },
  });
}

export function useRescheduleScheduledWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; scheduledDate: string }) => {
      const { data, error } = await supabase
        .from('scheduled_workouts')
        .update({ scheduled_date: params.scheduledDate })
        .eq('id', params.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduledWorkouts'] });
    },
  });
}

export function useDeleteScheduledWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('scheduled_workouts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['scheduledWorkouts'] });
      queryClient.invalidateQueries({ queryKey: ['scheduledWorkout', id] });
    },
  });
}
