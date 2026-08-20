import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import type { Database } from '../../../types/database';
import type { ProgramDayWithExercises } from './programs';

type WorkoutTemplateRow = Database['public']['Tables']['workout_templates']['Row'];
type TemplateExerciseRow = Database['public']['Tables']['workout_template_exercises']['Row'];
type TemplateExerciseInsert = Database['public']['Tables']['workout_template_exercises']['Insert'];
type ExerciseRow = Database['public']['Tables']['exercises']['Row'];

export type TemplateExerciseWithExercise = TemplateExerciseRow & {
  exercises: Pick<ExerciseRow, 'id' | 'name' | 'category' | 'primary_muscle'>;
};
export type WorkoutTemplateTree = WorkoutTemplateRow & {
  workout_template_exercises: TemplateExerciseWithExercise[];
};
export type WorkoutTemplateSummary = WorkoutTemplateRow & {
  workout_template_exercises: Array<{ order_index: number; exercises: Pick<ExerciseRow, 'name'> }>;
};

export async function fetchWorkoutTemplates(userId: string, search: string): Promise<WorkoutTemplateSummary[]> {
  let query = supabase
    .from('workout_templates')
    .select('*, workout_template_exercises ( order_index, exercises ( name ) )')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (search.trim()) query = query.ilike('name', `%${search.trim()}%`);

  const { data, error } = await query;
  if (error) throw error;
  return data as WorkoutTemplateSummary[];
}

export function useWorkoutTemplates(userId: string | null, search = '') {
  return useQuery({
    queryKey: ['workoutTemplates', userId, search],
    queryFn: () => fetchWorkoutTemplates(userId as string, search),
    enabled: userId != null,
  });
}

export async function fetchWorkoutTemplate(templateId: string): Promise<WorkoutTemplateTree> {
  const { data, error } = await supabase
    .from('workout_templates')
    .select(
      `*,
      workout_template_exercises (
        *,
        exercises ( id, name, category, primary_muscle )
      )`,
    )
    .eq('id', templateId)
    .order('order_index', { foreignTable: 'workout_template_exercises' })
    .single();

  if (error) throw error;
  return data as WorkoutTemplateTree;
}

export function useWorkoutTemplate(templateId: string | undefined) {
  return useQuery({
    queryKey: ['workoutTemplate', templateId],
    queryFn: () => fetchWorkoutTemplate(templateId as string),
    enabled: templateId != null,
  });
}

export function useCreateWorkoutTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      userId: string;
      name: string;
      notes?: string | null;
      estimatedDurationMinutes?: number | null;
      sourceProgramDayId?: string | null;
    }) => {
      const insert: Database['public']['Tables']['workout_templates']['Insert'] = {
        user_id: params.userId,
        name: params.name,
        notes: params.notes ?? null,
        estimated_duration_minutes: params.estimatedDurationMinutes ?? null,
        source_program_day_id: params.sourceProgramDayId ?? null,
      };
      const { data, error } = await supabase.from('workout_templates').insert(insert).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workoutTemplates'] });
    },
  });
}

export function useUpdateWorkoutTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      id: string;
      name?: string;
      notes?: string | null;
      estimatedDurationMinutes?: number | null;
    }) => {
      const patch: Database['public']['Tables']['workout_templates']['Update'] = {
        name: params.name,
        notes: params.notes,
        estimated_duration_minutes: params.estimatedDurationMinutes,
      };
      const { data, error } = await supabase
        .from('workout_templates')
        .update(patch)
        .eq('id', params.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ['workoutTemplate', params.id] });
      queryClient.invalidateQueries({ queryKey: ['workoutTemplates'] });
    },
  });
}

export function useDeleteWorkoutTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('workout_templates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workoutTemplates'] });
    },
  });
}

function toTemplateExerciseInsert(
  workoutTemplateId: string,
  source: Pick<
    TemplateExerciseRow,
    | 'exercise_id'
    | 'order_index'
    | 'target_sets'
    | 'target_reps_min'
    | 'target_reps_max'
    | 'target_load_kg'
    | 'target_rpe'
    | 'rest_seconds'
    | 'notes'
  >,
): TemplateExerciseInsert {
  return {
    workout_template_id: workoutTemplateId,
    exercise_id: source.exercise_id,
    order_index: source.order_index,
    target_sets: source.target_sets,
    target_reps_min: source.target_reps_min,
    target_reps_max: source.target_reps_max,
    target_load_kg: source.target_load_kg,
    target_rpe: source.target_rpe,
    rest_seconds: source.rest_seconds,
    notes: source.notes,
  };
}

/** Copies a template's row + exercises into a brand-new template — an
 * independent duplicate, not a reference back to the original. */
export function useDuplicateWorkoutTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (template: WorkoutTemplateTree) => {
      const insert: Database['public']['Tables']['workout_templates']['Insert'] = {
        user_id: template.user_id,
        name: `${template.name} (Copy)`,
        notes: template.notes,
        estimated_duration_minutes: template.estimated_duration_minutes,
      };
      const { data: newTemplate, error } = await supabase
        .from('workout_templates')
        .insert(insert)
        .select()
        .single();
      if (error) throw error;

      if (template.workout_template_exercises.length > 0) {
        const rows = template.workout_template_exercises.map(te =>
          toTemplateExerciseInsert(newTemplate.id, te),
        );
        const { error: exercisesError } = await supabase.from('workout_template_exercises').insert(rows);
        if (exercisesError) throw exercisesError;
      }
      return newTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workoutTemplates'] });
    },
  });
}

/** "Save to Library" — copies a program day's exercises into a new,
 * independently-editable template. The program day itself is untouched. */
export function useCreateTemplateFromProgramDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { userId: string; day: ProgramDayWithExercises; name?: string }) => {
      const insert: Database['public']['Tables']['workout_templates']['Insert'] = {
        user_id: params.userId,
        name: params.name ?? params.day.title ?? 'Untitled Workout',
        source_program_day_id: params.day.id,
      };
      const { data: newTemplate, error } = await supabase
        .from('workout_templates')
        .insert(insert)
        .select()
        .single();
      if (error) throw error;

      if (params.day.program_exercises.length > 0) {
        const rows = params.day.program_exercises.map(pe =>
          toTemplateExerciseInsert(newTemplate.id, pe),
        );
        const { error: exercisesError } = await supabase.from('workout_template_exercises').insert(rows);
        if (exercisesError) throw exercisesError;
      }
      return newTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workoutTemplates'] });
    },
  });
}

export function useAddTemplateExercise() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (row: TemplateExerciseInsert) => {
      const { data, error } = await supabase
        .from('workout_template_exercises')
        .insert(row)
        .select('*, exercises ( id, name, category, primary_muscle )')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, row) => {
      queryClient.invalidateQueries({ queryKey: ['workoutTemplate', row.workout_template_id] });
      queryClient.invalidateQueries({ queryKey: ['workoutTemplates'] });
    },
  });
}

/** Plain function form of the mutation below — exported so
 * templateProgression.ts's post-workout sync can call it directly from
 * inside its own mutationFn (hooks can't be invoked outside a React
 * render), same "extract plain function, hook becomes thin wrapper"
 * pattern used for weeklySchedule.ts's assignWeeklySchedule/etc. Only a
 * partial `Update` patch is ever sent — Supabase's JSON serialization drops
 * `undefined`-valued keys, so a caller only touching e.g. target_sets
 * leaves every other column alone. */
export async function updateTemplateExercise(
  params: { id: string } & Database['public']['Tables']['workout_template_exercises']['Update'],
): Promise<TemplateExerciseRow> {
  const patch: Database['public']['Tables']['workout_template_exercises']['Update'] = {
    order_index: params.order_index,
    target_sets: params.target_sets,
    target_reps_min: params.target_reps_min,
    target_reps_max: params.target_reps_max,
    target_load_kg: params.target_load_kg,
    target_rpe: params.target_rpe,
    rest_seconds: params.rest_seconds,
    notes: params.notes,
  };
  const { data, error } = await supabase
    .from('workout_template_exercises')
    .update(patch)
    .eq('id', params.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export function useUpdateTemplateExercise() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      params: { id: string; templateId: string } & Database['public']['Tables']['workout_template_exercises']['Update'],
    ) => updateTemplateExercise(params),
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ['workoutTemplate', params.templateId] });
    },
  });
}

export function useRemoveTemplateExercise() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; templateId: string }) => {
      const { error } = await supabase.from('workout_template_exercises').delete().eq('id', params.id);
      if (error) throw error;
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ['workoutTemplate', params.templateId] });
      queryClient.invalidateQueries({ queryKey: ['workoutTemplates'] });
    },
  });
}

/** Batched order_index swap — one round trip per row, run in parallel. */
export function useReorderTemplateExercises() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { templateId: string; rows: Array<{ id: string; order_index: number }> }) => {
      const results = await Promise.all(
        params.rows.map(row =>
          supabase.from('workout_template_exercises').update({ order_index: row.order_index }).eq('id', row.id),
        ),
      );
      const failed = results.find(r => r.error);
      if (failed?.error) throw failed.error;
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ['workoutTemplate', params.templateId] });
    },
  });
}
