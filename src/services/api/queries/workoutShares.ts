import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import type { Database, WorkoutShareStatus, WorkoutShareType } from '../../../types/database';
import { resolveDayPlan, type ScheduledWorkoutLike } from '../../../utils/dayPlan';
import { assignCardioDay, assignWeeklySchedule, removeWeeklyScheduleForDay, type WeeklyScheduleEntry } from './weeklySchedule';
import type { ProgramTree } from './programs';
import type { WorkoutTemplateTree } from './workoutTemplates';
import type { ScheduledWorkoutTree } from './scheduledWorkouts';

export type WorkoutShareRow = Database['public']['Tables']['workout_shares']['Row'];

type ExerciseRow = Database['public']['Tables']['exercises']['Row'];

/** Everything besides name/id needed to recreate an equivalent exercise row
 * under the recipient's own account — kept snake_case (unlike the rest of
 * this file's camelCase) since it's really a stored fragment of the
 * exercises row meant for near-verbatim re-insertion at accept-time, not a
 * UI-facing field. */
export type CustomExerciseDetail = Pick<
  ExerciseRow,
  | 'category'
  | 'primary_muscle'
  | 'equipment'
  | 'instructions'
  | 'movement_pattern'
  | 'secondary_muscles'
  | 'difficulty'
  | 'joint_stress'
  | 'skill_requirement'
  | 'default_metric'
  | 'demo_media_url'
  | 'demo_media_type'
>;

export type WorkoutSnapshotExercise = {
  exerciseId: string;
  exerciseName: string;
  /** True when this exercise is the sender's own custom (non-stock) one —
   * RLS hides those from everyone but their creator, so it can't be
   * inserted as a live FK reference for the recipient either. */
  isCustom: boolean;
  /** Present only when isCustom — the rest of the source row, captured at
   * share-time so the recipient can get their own copy of it at accept-time
   * (see resolveExerciseIdMap below) instead of it just being dropped. */
  customExerciseDetail: CustomExerciseDetail | null;
  orderIndex: number;
  targetSets: number;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetRpe: number | null;
  restSeconds: number | null;
  notes: string | null;
};

export type WorkoutSnapshot = {
  name: string;
  notes: string | null;
  estimatedDurationMinutes: number | null;
  exercises: WorkoutSnapshotExercise[];
};

export type SingleWorkoutPayload = { workout: WorkoutSnapshot };

export type WeeklyPlanDay = {
  dayOfWeek: number;
  dayType: 'training' | 'cardio' | 'rest';
  workout: WorkoutSnapshot | null;
};
export type WeeklyPlanPayload = { days: WeeklyPlanDay[] };

export type WorkoutSharePayload = SingleWorkoutPayload | WeeklyPlanPayload;

/** Common exercise shape shared by workout_template_exercises,
 * program_exercises, and scheduled_workout_exercises (see
 * scheduledWorkouts.ts's own ScheduleExerciseInput, which this mirrors) —
 * anything shaped like this can be turned into a WorkoutSnapshot. */
type SnapshotSourceExercise = {
  exercise_id: string;
  exercises: { name: string };
  order_index: number;
  target_sets: number;
  target_reps_min: number | null;
  target_reps_max: number | null;
  target_rpe: number | null;
  rest_seconds: number | null;
  notes: string | null;
};

type SnapshotMeta = { name: string; notes: string | null; estimatedDurationMinutes: number | null };

/** Full exercise rows (not just id/is_custom) — a custom one needs its
 * whole row captured at share-time so it can be recreated for the
 * recipient later, since the sender's original stays permanently unreadable
 * to them (RLS hides custom exercises from everyone but their creator). */
async function fetchExerciseDetailsById(exerciseIds: string[]): Promise<Map<string, ExerciseRow>> {
  if (exerciseIds.length === 0) return new Map();
  const { data, error } = await supabase.from('exercises').select('*').in('id', exerciseIds);
  if (error) throw error;
  return new Map(data.map(row => [row.id, row]));
}

/** Pure mapping/sort core of buildWorkoutSnapshot — split out so the
 * exercise-shaping logic (order, field mapping, is_custom lookup) can be
 * unit tested without a live Supabase client, matching this codebase's
 * convention of only unit-testing the pure half of a query file (see
 * weeklySchedule.test.ts). */
export function toSnapshot(meta: SnapshotMeta, exercises: SnapshotSourceExercise[], detailsById: Map<string, ExerciseRow>): WorkoutSnapshot {
  return {
    name: meta.name,
    notes: meta.notes,
    estimatedDurationMinutes: meta.estimatedDurationMinutes,
    exercises: [...exercises]
      .sort((a, b) => a.order_index - b.order_index)
      .map(e => {
        const detail = detailsById.get(e.exercise_id);
        return {
          exerciseId: e.exercise_id,
          exerciseName: e.exercises.name,
          isCustom: detail?.is_custom ?? false,
          customExerciseDetail:
            detail?.is_custom
              ? {
                  category: detail.category,
                  primary_muscle: detail.primary_muscle,
                  equipment: detail.equipment,
                  instructions: detail.instructions,
                  movement_pattern: detail.movement_pattern,
                  secondary_muscles: detail.secondary_muscles,
                  difficulty: detail.difficulty,
                  joint_stress: detail.joint_stress,
                  skill_requirement: detail.skill_requirement,
                  default_metric: detail.default_metric,
                  demo_media_url: detail.demo_media_url,
                  demo_media_type: detail.demo_media_type,
                }
              : null,
          orderIndex: e.order_index,
          targetSets: e.target_sets,
          targetRepsMin: e.target_reps_min,
          targetRepsMax: e.target_reps_max,
          targetRpe: e.target_rpe,
          restSeconds: e.rest_seconds,
          notes: e.notes,
        };
      }),
  };
}

/** Builds a shareable snapshot from any of the three workout-viewing
 * screens' already-fetched data (a weekly template, an AI program day, or a
 * one-off scheduled workout — all three share this exercise field shape).
 * Used by the sender screens before navigating to ShareWorkout, since
 * nothing has a share id yet at that point. */
export async function buildWorkoutSnapshot(meta: SnapshotMeta, exercises: SnapshotSourceExercise[]): Promise<WorkoutSnapshot> {
  const detailsById = await fetchExerciseDetailsById([...new Set(exercises.map(e => e.exercise_id))]);
  return toSnapshot(meta, exercises, detailsById);
}

async function fetchWorkoutTemplatesByIds(ids: string[]): Promise<Map<string, WorkoutTemplateTree>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from('workout_templates')
    .select('*, workout_template_exercises ( *, exercises ( id, name, category, primary_muscle ) )')
    .in('id', ids);
  if (error) throw error;
  return new Map((data as WorkoutTemplateTree[]).map(t => [t.id, t]));
}

async function fetchScheduledWorkoutsByIds(ids: string[]): Promise<Map<string, ScheduledWorkoutTree>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from('scheduled_workouts')
    .select('*, scheduled_workout_exercises ( *, exercises ( id, name, category, primary_muscle ) )')
    .in('id', ids);
  if (error) throw error;
  return new Map((data as ScheduledWorkoutTree[]).map(s => [s.id, s]));
}

/**
 * Builds a 7-day (Sun-Sat) shareable snapshot of "this week" exactly as the
 * Training tab currently shows it — resolving each day the same way
 * CalendarScreen does (resolveDayPlan: one-off scheduled workout > weekly
 * recurring template > active AI program day > rest), so it works
 * identically whether the sender is on a manual Weekly Schedule or an
 * active AI-generated program. workoutLogs/dayOverrides are deliberately
 * left out of the resolution — a share reflects the *plan*, not this
 * week's completion/override state (a day marked "missed" should still
 * share as whatever its underlying plan was).
 */
export async function fetchWeeklyPlanSnapshot(params: {
  program: ProgramTree | null | undefined;
  weeklySchedule: WeeklyScheduleEntry[] | null | undefined;
  scheduledWorkouts: ScheduledWorkoutLike[] | null | undefined;
  /** 7 dates, Sunday first — same as CalendarScreen's own thisWeekDates. */
  weekDates: Date[];
}): Promise<WeeklyPlanPayload> {
  const { program, weeklySchedule, scheduledWorkouts, weekDates } = params;

  const resolved = weekDates.map(date =>
    resolveDayPlan({ date, program, weeklySchedule, scheduledWorkouts, workoutLogs: null, dayOverrides: null }),
  );

  const templateIds = [
    ...new Set(
      resolved.flatMap(r => (r.kind === 'weeklyRecurring' && r.entry.workout_template_id ? [r.entry.workout_template_id] : [])),
    ),
  ];
  const scheduledIds = [...new Set(resolved.flatMap(r => (r.kind === 'scheduled' ? [r.scheduledWorkout.id] : [])))];

  const [templatesById, scheduledById] = await Promise.all([
    fetchWorkoutTemplatesByIds(templateIds),
    fetchScheduledWorkoutsByIds(scheduledIds),
  ]);

  // One batched exercise-detail lookup across every exercise touched this
  // week, rather than one lookup per day — same "fetch a list of ids in one
  // round trip" idiom the rest of this file (and this codebase) uses.
  const allExerciseIds = new Set<string>();
  for (const template of templatesById.values()) {
    for (const te of template.workout_template_exercises) allExerciseIds.add(te.exercise_id);
  }
  for (const scheduled of scheduledById.values()) {
    for (const se of scheduled.scheduled_workout_exercises) allExerciseIds.add(se.exercise_id);
  }
  for (const r of resolved) {
    if (r.kind === 'programTraining') {
      for (const pe of r.day.program_exercises) allExerciseIds.add(pe.exercise_id);
    }
  }
  const detailsById = await fetchExerciseDetailsById([...allExerciseIds]);

  const days: WeeklyPlanDay[] = resolved.map((r, dayOfWeek) => {
    switch (r.kind) {
      case 'scheduled': {
        const scheduled = scheduledById.get(r.scheduledWorkout.id);
        if (!scheduled) return { dayOfWeek, dayType: 'rest', workout: null };
        return {
          dayOfWeek,
          dayType: 'training',
          workout: toSnapshot(
            { name: scheduled.name, notes: scheduled.notes, estimatedDurationMinutes: null },
            scheduled.scheduled_workout_exercises,
            detailsById,
          ),
        };
      }
      case 'weeklyRecurring': {
        const template = r.entry.workout_template_id ? templatesById.get(r.entry.workout_template_id) : undefined;
        if (!template) return { dayOfWeek, dayType: 'rest', workout: null };
        return {
          dayOfWeek,
          dayType: 'training',
          workout: toSnapshot(
            { name: template.name, notes: template.notes, estimatedDurationMinutes: template.estimated_duration_minutes },
            template.workout_template_exercises,
            detailsById,
          ),
        };
      }
      case 'weeklyCardio':
      case 'programCardio':
      case 'overrideCardio':
        return { dayOfWeek, dayType: 'cardio', workout: null };
      case 'programTraining':
        return {
          dayOfWeek,
          dayType: 'training',
          workout: toSnapshot({ name: r.day.title ?? 'Training Day', notes: null, estimatedDurationMinutes: null }, r.day.program_exercises, detailsById),
        };
      default:
        return { dayOfWeek, dayType: 'rest', workout: null };
    }
  });

  return { days };
}

// ---------------------------------------------------------------------------
// Sending a share
// ---------------------------------------------------------------------------

/** Creates the workout_shares row, then a dm_messages row pointing at it —
 * two sequential inserts (no DB transaction/RPC), matching this codebase's
 * existing convention for multi-step mutations (e.g. PostFab's
 * picker-then-upload flow). recipientId always comes from the same
 * conversation the message lands in (never independently supplied), so a
 * share can never end up addressed to someone other than who it was sent
 * to. */
export function useCreateWorkoutShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      conversationId: string;
      senderId: string;
      recipientId: string;
      shareType: WorkoutShareType;
      title: string;
      payload: WorkoutSharePayload;
    }) => {
      const { data: share, error: shareError } = await supabase
        .from('workout_shares')
        .insert({
          sender_id: params.senderId,
          recipient_id: params.recipientId,
          share_type: params.shareType,
          title: params.title,
          payload: params.payload,
        })
        .select()
        .single();
      if (shareError) throw shareError;

      const { error: messageError } = await supabase.from('dm_messages').insert({
        conversation_id: params.conversationId,
        sender_id: params.senderId,
        workout_share_id: share.id,
      });
      if (messageError) throw messageError;

      return share as WorkoutShareRow;
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ['dmMessages', params.conversationId] });
      queryClient.invalidateQueries({ queryKey: ['dmConversations', params.senderId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Reviewing + responding to a share
// ---------------------------------------------------------------------------

async function fetchWorkoutShare(shareId: string): Promise<WorkoutShareRow> {
  const { data, error } = await supabase.from('workout_shares').select('*').eq('id', shareId).single();
  if (error) throw error;
  return data;
}

export function useWorkoutShare(shareId: string | undefined) {
  return useQuery({
    queryKey: ['workoutShare', shareId],
    queryFn: () => fetchWorkoutShare(shareId as string),
    enabled: shareId != null,
  });
}

/** Resolves every custom exercise across the whole share (all workouts —
 * one call for a single workout, one call up front covering all 7 days for
 * a weekly plan) to an id the recipient can actually reference. Stock
 * exercises already pass through as-is elsewhere (globally readable, see
 * exercises_select RLS) and never reach this function. For a custom one:
 * reuse a match if the recipient already has an equivalent (either their
 * own same-named custom exercise from an earlier accept, or a same-named
 * stock exercise) — otherwise create a new custom exercise owned by the
 * recipient from the captured customExerciseDetail, so the exercise is
 * actually shared rather than silently dropped. Only truly drops an
 * exercise when it's custom AND the share predates this — no
 * customExerciseDetail was captured to recreate it from.
 *
 * Called once per accept (not per-workout) so the same custom exercise
 * shared across multiple days of a week only ever gets created once. */
async function resolveExerciseIdMap(
  workouts: WorkoutSnapshot[],
  recipientId: string,
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();
  const uniqueCustom = new Map<string, WorkoutSnapshotExercise>();
  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      if (exercise.isCustom) {
        if (!uniqueCustom.has(exercise.exerciseId)) uniqueCustom.set(exercise.exerciseId, exercise);
      } else {
        idMap.set(exercise.exerciseId, exercise.exerciseId);
      }
    }
  }
  if (uniqueCustom.size === 0) return idMap;

  const names = [...new Set([...uniqueCustom.values()].map(e => e.exerciseName))];
  const { data: existing, error } = await supabase
    .from('exercises')
    .select('id, name')
    .in('name', names)
    .or(`is_custom.eq.false,created_by.eq.${recipientId}`);
  if (error) throw error;
  const existingByName = new Map(existing.map(row => [row.name, row.id]));

  for (const [originalExerciseId, exercise] of uniqueCustom) {
    const matchedId = existingByName.get(exercise.exerciseName);
    if (matchedId) {
      idMap.set(originalExerciseId, matchedId);
      continue;
    }
    if (!exercise.customExerciseDetail) continue; // pre-fix share with no detail to recreate from

    const detail = exercise.customExerciseDetail;
    const { data: created, error: createError } = await supabase
      .from('exercises')
      .insert({
        name: exercise.exerciseName,
        category: detail.category,
        primary_muscle: detail.primary_muscle,
        equipment: detail.equipment,
        instructions: detail.instructions,
        movement_pattern: detail.movement_pattern,
        secondary_muscles: detail.secondary_muscles,
        difficulty: detail.difficulty,
        joint_stress: detail.joint_stress,
        skill_requirement: detail.skill_requirement,
        default_metric: detail.default_metric,
        demo_media_url: detail.demo_media_url,
        demo_media_type: detail.demo_media_type,
        is_custom: true,
        created_by: recipientId,
      })
      .select('id')
      .single();
    if (createError) throw createError;
    idMap.set(originalExerciseId, created.id);
    existingByName.set(exercise.exerciseName, created.id); // dedupe within this same batch too
  }

  return idMap;
}

async function createTemplateForRecipient(
  recipientId: string,
  workout: WorkoutSnapshot,
  idMap: Map<string, string>,
): Promise<{ templateId: string; droppedCount: number }> {
  const resolved: Array<WorkoutSnapshotExercise & { exerciseId: string }> = [];
  let droppedCount = 0;
  for (const exercise of workout.exercises) {
    const resolvedId = idMap.get(exercise.exerciseId);
    if (resolvedId) {
      resolved.push({ ...exercise, exerciseId: resolvedId });
    } else {
      droppedCount += 1;
    }
  }

  const { data: newTemplate, error: templateError } = await supabase
    .from('workout_templates')
    .insert({
      user_id: recipientId,
      name: workout.name,
      notes: workout.notes,
      estimated_duration_minutes: workout.estimatedDurationMinutes,
    })
    .select()
    .single();
  if (templateError) throw templateError;

  if (resolved.length > 0) {
    const rows: Database['public']['Tables']['workout_template_exercises']['Insert'][] = resolved.map(e => ({
      workout_template_id: newTemplate.id,
      exercise_id: e.exerciseId,
      order_index: e.orderIndex,
      target_sets: e.targetSets,
      target_reps_min: e.targetRepsMin,
      target_reps_max: e.targetRepsMax,
      target_rpe: e.targetRpe,
      rest_seconds: e.restSeconds,
      notes: e.notes,
    }));
    const { error: exercisesError } = await supabase.from('workout_template_exercises').insert(rows);
    if (exercisesError) throw exercisesError;
  }

  return { templateId: newTemplate.id, droppedCount };
}

async function respondToShare(shareId: string, status: WorkoutShareStatus): Promise<void> {
  const { error } = await supabase
    .from('workout_shares')
    .update({ status, responded_at: new Date().toISOString() })
    .eq('id', shareId);
  if (error) throw error;
}

/** "Add to My Plan" — creates the recipient's own workout_template(s) from
 * the snapshot, then writes weekly_schedule via the SAME upsert-on-conflict
 * mutations the Training tab's own assignment screens use (imported as
 * plain functions, not reimplemented — see weeklySchedule.ts), so this gets
 * the exact same "overwrite what's there" behavior for free. A single
 * workout takes an explicit dayOfWeek and overwrites just that one day; a
 * weekly plan applies all 7 entries from its own payload in one call —
 * training/cardio days get created+assigned, rest days get any existing
 * assignment removed. */
export function useAcceptWorkoutShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { share: WorkoutShareRow; recipientId: string; dayOfWeek?: number }) => {
      let droppedCount = 0;

      if (params.share.share_type === 'single_workout') {
        if (params.dayOfWeek == null) throw new Error('Choose a day to assign this workout to.');
        const payload = params.share.payload as SingleWorkoutPayload;
        const idMap = await resolveExerciseIdMap([payload.workout], params.recipientId);
        const { templateId, droppedCount: dropped } = await createTemplateForRecipient(params.recipientId, payload.workout, idMap);
        droppedCount += dropped;
        await assignWeeklySchedule({ userId: params.recipientId, dayOfWeek: params.dayOfWeek, workoutTemplateId: templateId });
      } else {
        const payload = params.share.payload as WeeklyPlanPayload;
        const workouts = payload.days.flatMap(d => (d.workout ? [d.workout] : []));
        const idMap = await resolveExerciseIdMap(workouts, params.recipientId);
        for (const day of payload.days) {
          if (day.dayType === 'rest' || !day.workout) {
            await removeWeeklyScheduleForDay({ userId: params.recipientId, dayOfWeek: day.dayOfWeek });
          } else if (day.dayType === 'cardio') {
            await assignCardioDay({ userId: params.recipientId, dayOfWeek: day.dayOfWeek });
          } else {
            const { templateId, droppedCount: dropped } = await createTemplateForRecipient(params.recipientId, day.workout, idMap);
            droppedCount += dropped;
            await assignWeeklySchedule({ userId: params.recipientId, dayOfWeek: day.dayOfWeek, workoutTemplateId: templateId });
          }
        }
      }

      await respondToShare(params.share.id, 'accepted');
      return { droppedCount };
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ['weeklySchedule', params.recipientId] });
      queryClient.invalidateQueries({ queryKey: ['workoutTemplates', params.recipientId] });
      queryClient.invalidateQueries({ queryKey: ['workoutShare', params.share.id] });
    },
  });
}

export function useDeclineWorkoutShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { shareId: string }) => respondToShare(params.shareId, 'declined'),
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ['workoutShare', params.shareId] });
    },
  });
}
