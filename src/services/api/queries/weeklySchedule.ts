import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import type { Database } from '../../../types/database';

type WeeklyScheduleRow = Database['public']['Tables']['weekly_schedule']['Row'];

/** Lean list shape — name + exercise count only, no per-exercise sets/reps/
 * rpe/rest. Mirrors WorkoutTemplateSummary's own list-vs-detail split in
 * workoutTemplates.ts; full detail is fetched separately, by id, only when
 * actually viewing a day (TrainingDayDetailScreen uses useWorkoutTemplate).
 * `workout_templates` is nullable because `workout_template_id` itself is —
 * a cardio day (day_type='cardio') has no template; the DB's
 * weekly_schedule_template_required_for_training check constraint
 * guarantees it's present whenever day_type is 'training'. */
export type WeeklyScheduleEntry = WeeklyScheduleRow & {
  workout_templates: {
    id: string;
    name: string;
    workout_template_exercises: Array<{ order_index: number }>;
  } | null;
};

async function fetchWeeklySchedule(userId: string): Promise<WeeklyScheduleEntry[]> {
  const { data, error } = await supabase
    .from('weekly_schedule')
    .select('*, workout_templates ( id, name, workout_template_exercises ( order_index ) )')
    .eq('user_id', userId)
    .order('day_of_week');
  if (error) throw error;
  return data as WeeklyScheduleEntry[];
}

export function useWeeklySchedule(userId: string | null) {
  return useQuery({
    queryKey: ['weeklySchedule', userId],
    queryFn: () => fetchWeeklySchedule(userId as string),
    enabled: userId != null,
  });
}

/** Same day assigned twice is an upsert, not add-then-remove — the unique
 * (user_id, day_of_week) constraint makes re-assigning a day just replace
 * whatever was there. Explicitly sets day_type='training' even though this
 * mutation predates cardio days — an upsert only touches the columns it's
 * given, so re-assigning a day that was previously cardio would otherwise
 * leave day_type='cardio' stuck alongside a newly-set template.
 *
 * Exported as a plain function (not just the hook below) so
 * workoutShares.ts's accept-a-shared-workout mutation can call it directly
 * from inside its own mutationFn — hooks can't be invoked outside a React
 * render, so the mutation logic itself has to live here as reusable, and the
 * hook becomes a thin wrapper. */
export async function assignWeeklySchedule(params: {
  userId: string;
  dayOfWeek: number;
  workoutTemplateId: string;
}): Promise<WeeklyScheduleRow> {
  const { data, error } = await supabase
    .from('weekly_schedule')
    .upsert(
      {
        user_id: params.userId,
        day_of_week: params.dayOfWeek,
        workout_template_id: params.workoutTemplateId,
        day_type: 'training',
      },
      { onConflict: 'user_id,day_of_week' },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export function useAssignWeeklySchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: assignWeeklySchedule,
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ['weeklySchedule', params.userId] });
    },
  });
}

/** Cardio's equivalent of assignWeeklySchedule — same upsert-on-conflict
 * target, but no template to point at (activity/params are chosen at log
 * time, not assignment time, per LogCardioScreen). Also exported plain, same
 * reasoning as assignWeeklySchedule above. */
export async function assignCardioDay(params: { userId: string; dayOfWeek: number }): Promise<WeeklyScheduleRow> {
  const { data, error } = await supabase
    .from('weekly_schedule')
    .upsert(
      { user_id: params.userId, day_of_week: params.dayOfWeek, day_type: 'cardio', workout_template_id: null },
      { onConflict: 'user_id,day_of_week' },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export function useAssignCardioDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: assignCardioDay,
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ['weeklySchedule', params.userId] });
    },
  });
}

/** Plain-function counterpart to useRemoveWeeklySchedule, same reasoning as
 * assignWeeklySchedule above — "make this day rest" for the weekly-plan
 * accept flow needs to call this directly, not through a hook. */
export async function removeWeeklySchedule(params: { id: string; userId: string }): Promise<void> {
  const { error } = await supabase.from('weekly_schedule').delete().eq('id', params.id);
  if (error) throw error;
}

/** Same delete as removeWeeklySchedule, but targeted by (userId, dayOfWeek)
 * instead of a known row id — for the weekly-plan accept flow, which is
 * making an arbitrary day rest and may not have (or need) that day's
 * existing row id to do it. No-ops if the day was already rest (no row to
 * delete), which is exactly the outcome an "accept" should produce either
 * way. */
export async function removeWeeklyScheduleForDay(params: { userId: string; dayOfWeek: number }): Promise<void> {
  const { error } = await supabase
    .from('weekly_schedule')
    .delete()
    .eq('user_id', params.userId)
    .eq('day_of_week', params.dayOfWeek);
  if (error) throw error;
}

export function useRemoveWeeklySchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeWeeklySchedule,
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ['weeklySchedule', params.userId] });
    },
  });
}

/** Same shape/spirit as getProgramDayForDate (programs.ts) — pure, no
 * anchoring to when the assignment was created (see WeekTimeline for the
 * one place that distinction matters). */
export function getWeeklyScheduleForDate(
  schedule: WeeklyScheduleEntry[] | null | undefined,
  date: Date,
): WeeklyScheduleEntry | null {
  if (!schedule) return null;
  return schedule.find(entry => entry.day_of_week === date.getDay()) ?? null;
}
