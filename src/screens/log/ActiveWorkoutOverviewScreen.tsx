import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { TAB_BAR_FLOAT_FOOTPRINT } from '../../navigation/MainTabs';
import {
  Text,
  Card,
  Button,
  Icon,
  ListRow,
  BottomSheet,
  LoadingState,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import {
  useActiveWorkoutStore,
  isExerciseComplete,
  computeWorkoutStats,
  type ActiveExercise,
  type SetMetric,
  type WorkoutSource,
} from '../../store/activeWorkoutStore';
import { useProgramDay } from '../../services/api/queries/programs';
import {
  useScheduledWorkout,
  useDeleteScheduledWorkout,
} from '../../services/api/queries/scheduledWorkouts';
import { useWorkoutTemplate } from '../../services/api/queries/workoutTemplates';
import {
  useStartWorkoutLog,
  useDeleteWorkoutLog,
} from '../../services/api/queries/workoutLogs';
import { useWorkoutAdaptations } from '../../services/api/queries/coaching';
import { useExercises } from '../../services/api/queries/exercises';
import { useProfile } from '../../services/api/queries/profiles';
import {
  coachingEngine,
  type WorkoutVariantResult,
} from '../../services/coaching';
import { ActiveWorkoutHeader } from './ActiveWorkoutHeader';
import { ReorderableExerciseList } from './ReorderableExerciseList';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import { exerciseRowToMetadata } from '../../utils/exerciseMetadata';
import { buildVariantSourceExercises } from '../../utils/variantSource';
import type {
  ProgramsStackParamList,
  RootStackParamList,
} from '../../navigation/types';
import type { Database, EquipmentType } from '../../types/database';

type WorkoutAdaptationRow =
  Database['public']['Tables']['workout_adaptations']['Row'];

/** Only fields that map onto a numeric ActiveExercise target — 'workout_type'
 * (the recovery_replacement marker) has no ActiveExercise field to write to. */
const ADAPTATION_FIELD_TO_KEY: Partial<
  Record<
    string,
    | 'targetSets'
    | 'targetRepsMin'
    | 'targetRepsMax'
    | 'targetLoadKg'
    | 'targetRpe'
    | 'restSeconds'
  >
> = {
  target_sets: 'targetSets',
  target_load_kg: 'targetLoadKg',
  target_rpe: 'targetRpe',
  rest_seconds: 'restSeconds',
};

function applyAcceptedAdaptations(
  exercises: Array<Omit<ActiveExercise, 'sets' | 'notes' | 'metric'>>,
  adaptations: WorkoutAdaptationRow[],
): Array<Omit<ActiveExercise, 'sets' | 'notes' | 'metric'>> {
  const accepted = adaptations.filter(a => a.status === 'accepted');
  if (accepted.length === 0) return exercises;
  return exercises.map(exercise => {
    let updated = exercise;
    for (const adaptation of accepted) {
      if (
        adaptation.target_exercise_id != null &&
        adaptation.target_exercise_id !== exercise.exerciseId
      )
        continue;
      const key = ADAPTATION_FIELD_TO_KEY[adaptation.field_changed];
      if (!key) continue;
      const value = adaptation.updated_value;
      if (typeof value !== 'number') continue;
      updated = { ...updated, [key]: value };
    }
    return updated;
  });
}

/** program_exercises / scheduled_workout_exercises / workout_template_exercises
 * all share this exact shape, so one mapper covers every start source. */
type TargetRow = {
  exercises: { id: string; name: string };
  target_sets: number;
  target_reps_min: number | null;
  target_reps_max: number | null;
  target_load_kg: number | null;
  target_rpe: number | null;
  rest_seconds: number | null;
};

function mapTargetsToActiveExercises(
  rows: TargetRow[],
): Array<Omit<ActiveExercise, 'sets' | 'notes' | 'metric'>> {
  return rows.map(row => ({
    exerciseId: row.exercises.id,
    exerciseName: row.exercises.name,
    targetSets: row.target_sets,
    targetRepsMin: row.target_reps_min,
    targetRepsMax: row.target_reps_max,
    targetLoadKg: row.target_load_kg,
    targetRpe: row.target_rpe,
    restSeconds: row.rest_seconds,
  }));
}

/** Normalizes a route-derived `null` (no params) to the same key as the
 * store's `{type:'freestyle', id:null}` so an in-progress freestyle session
 * doesn't look "stale" and get wiped out by the auto-start effect. */
function sourceKey(source: WorkoutSource | null): string {
  const normalized = source ?? { type: 'freestyle' as const, id: null };
  return `${normalized.type}:${normalized.id}`;
}

type Route = RouteProp<ProgramsStackParamList, 'ActiveWorkoutOverview'>;
type Nav = NativeStackNavigationProp<ProgramsStackParamList>;
type RootNav = NativeStackNavigationProp<RootStackParamList>;

export function ActiveWorkoutOverviewScreen() {
  const theme = useTheme();
  const navigation = useNavigation<Nav>();
  const rootNavigation = useNavigation<RootNav>();
  const { params } = useRoute<Route>();

  const routeSource: WorkoutSource | null = params?.programDayId
    ? { type: 'programDay', id: params.programDayId }
    : params?.scheduledWorkoutId
    ? { type: 'scheduledWorkout', id: params.scheduledWorkoutId }
    : params?.templateId
    ? { type: 'template', id: params.templateId }
    : null;

  const userId = useAuthStore(state => state.userId);
  const { data: programDay, isLoading: dayLoading } = useProgramDay(
    routeSource?.type === 'programDay' ? routeSource.id : undefined,
  );
  const { data: scheduledWorkout, isLoading: scheduledLoading } =
    useScheduledWorkout(
      routeSource?.type === 'scheduledWorkout' ? routeSource.id : undefined,
    );
  const { data: template, isLoading: templateLoading } = useWorkoutTemplate(
    routeSource?.type === 'template' ? routeSource.id : undefined,
  );
  const { data: workoutAdaptations } = useWorkoutAdaptations(userId, {
    programDayId:
      routeSource?.type === 'programDay' ? routeSource.id : undefined,
    scheduledWorkoutId:
      routeSource?.type === 'scheduledWorkout' ? routeSource.id : undefined,
  });
  const acceptedAdaptationCount = (workoutAdaptations ?? []).filter(
    a => a.status === 'accepted',
  ).length;
  const unitPref = useUnitPreference();
  const { data: profile } = useProfile(userId);
  const { data: allExercises } = useExercises('');
  const [appliedVariant, setAppliedVariant] =
    useState<WorkoutVariantResult | null>(null);
  const [optionsSheetOpen, setOptionsSheetOpen] = useState(false);

  // Individual selectors, not `useActiveWorkoutStore()` — the store's rest
  // timer ticks restSecondsRemaining/restEndsAt every second during a rest
  // period (see activeWorkoutStore's restIntervalId), and none of those
  // fields are read by this screen. A whole-store subscription would
  // re-render this screen (including the full exercises.map() list below)
  // once a second throughout every rest period for no reason.
  const workoutLogId = useActiveWorkoutStore(state => state.workoutLogId);
  const source = useActiveWorkoutStore(state => state.source);
  const exercises = useActiveWorkoutStore(state => state.exercises);
  const startedAt = useActiveWorkoutStore(state => state.startedAt);
  const resetActiveWorkout = useActiveWorkoutStore(state => state.reset);
  const startWorkout = useActiveWorkoutStore(state => state.startWorkout);
  const reorderExercises = useActiveWorkoutStore(state => state.reorderExercises);
  const startWorkoutLog = useStartWorkoutLog();
  const deleteWorkoutLog = useDeleteWorkoutLog();
  const deleteScheduledWorkout = useDeleteScheduledWorkout();
  // Guided workouts (a source is set in params) start as soon as the user
  // taps "Start Workout" elsewhere, so auto-starting here is fine. Freestyle
  // has no such prior intent signal — auto-starting on tab focus would
  // silently create a workout_logs row just from opening the Training tab,
  // so it waits for an explicit "Start Freestyle Workout" tap.
  const [freestyleStarted, setFreestyleStarted] = useState(false);
  // Both "Delete Workout" below and a normal Finish Workout -> Save (on
  // WorkoutSummaryScreen, a sibling screen further down this same
  // ProgramsStack) reset the store (workoutLogId -> null) without
  // unmounting this screen — the bottom-tab navigator keeps ProgramsStack
  // mounted in the background when navigating to another tab or screen.
  // Without a guard, the auto-start effect below would see that reset as
  // "no session, but a route target is still here" and silently start a
  // brand-new workout for the same target, which is what made
  // completed/deleted sessions appear to "restart" themselves the next time
  // the Training tab was opened.
  //
  // hadSessionRef tracks whether *this instance* has ever shown a live
  // session; once true, seeing workoutLogId go back to null means that
  // session ended, not that one has never started. It's a ref (mutated
  // inline during render, not in an effect) so the derived value below is
  // correct in the very same commit the store changes — an effect-based flag
  // would still be one render behind, since effects for this commit already
  // read the pre-update closure.
  const hadSessionRef = useRef(workoutLogId != null);
  if (workoutLogId != null) hadSessionRef.current = true;
  const sessionJustEnded = hadSessionRef.current && workoutLogId == null;

  const needsFreshStart =
    workoutLogId == null ||
    sourceKey(source) !== sourceKey(routeSource);
  const sourceDataLoaded =
    routeSource == null ||
    (routeSource.type === 'programDay' && programDay != null) ||
    (routeSource.type === 'scheduledWorkout' && scheduledWorkout != null) ||
    (routeSource.type === 'template' && template != null);
  const readyToStart = !needsFreshStart || sourceDataLoaded;
  const shouldAutoStart = routeSource != null || freestyleStarted;
  const requestedVariant =
    params?.variantType && params.variantType !== 'full'
      ? params.variantType
      : null;
  // A variant needs the full exercise library for substitution/metadata —
  // hold off starting until it's loaded rather than silently starting the
  // unmodified workout.
  const variantDataReady = !requestedVariant || allExercises != null;

  useEffect(() => {
    if (
      !needsFreshStart ||
      !userId ||
      !readyToStart ||
      !shouldAutoStart ||
      !variantDataReady ||
      sessionJustEnded
    )
      return;

    let cancelled = false;
    (async () => {
      try {
        const created = await startWorkoutLog.mutateAsync({
          userId,
          programDayId:
            routeSource?.type === 'programDay' ? routeSource.id : null,
          scheduledWorkoutId:
            routeSource?.type === 'scheduledWorkout' ? routeSource.id : null,
          variantType: params?.variantType ?? null,
        });
        if (cancelled) return;

        const targets =
          routeSource?.type === 'programDay' && programDay
            ? programDay.program_exercises
            : routeSource?.type === 'scheduledWorkout' && scheduledWorkout
            ? scheduledWorkout.scheduled_workout_exercises
            : routeSource?.type === 'template' && template
            ? template.workout_template_exercises
            : [];
        const defaultMetric: SetMetric =
          unitPref === 'lb' ? 'weight_lb' : 'weight_kg';

        let baseTargets = mapTargetsToActiveExercises(targets);
        if (requestedVariant && allExercises) {
          const source = buildVariantSourceExercises(targets, allExercises);
          const availableEquipment =
            (profile?.equipment_access as EquipmentType[] | undefined) ?? null;
          const variantResult = coachingEngine.generateWorkoutVariant({
            source,
            variantType: requestedVariant,
            candidates: allExercises.map(exerciseRowToMetadata),
            availableEquipment,
          });
          baseTargets = variantResult.exercises.map(e => ({
            exerciseId: e.exerciseId,
            exerciseName: e.exerciseName,
            targetSets: e.targetSets,
            targetRepsMin: e.targetRepsMin,
            targetRepsMax: e.targetRepsMax,
            targetLoadKg: e.targetLoadKg,
            targetRpe: e.targetRpe,
            restSeconds: e.restSeconds,
          }));
          setAppliedVariant(variantResult);
        }

        const adaptedTargets = applyAcceptedAdaptations(
          baseTargets,
          workoutAdaptations ?? [],
        );
        const exercises = adaptedTargets.map(e => ({
          ...e,
          metric: defaultMetric,
        }));

        startWorkout({
          workoutLogId: created.id,
          source: routeSource ?? { type: 'freestyle', id: null },
          exercises,
        });
      } catch (err) {
        if (cancelled) return;
        Alert.alert(
          'Could not start workout',
          err instanceof Error ? err.message : 'Please try again.',
        );
        setFreestyleStarted(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    needsFreshStart,
    userId,
    readyToStart,
    shouldAutoStart,
    variantDataReady,
    sessionJustEnded,
    routeSource?.type,
    routeSource?.id,
    programDay,
    scheduledWorkout,
    template,
    workoutAdaptations,
    requestedVariant,
    allExercises,
    profile?.equipment_access,
  ]);

  // Reset the freestyle intent flag once the session actually ends (store
  // reset happens on the Workout Summary screen after saving), otherwise a
  // stale `freestyleStarted` would silently auto-start a new session the
  // next time this screen is focused.
  useEffect(() => {
    if (workoutLogId == null) setFreestyleStarted(false);
  }, [workoutLogId]);

  const stats = computeWorkoutStats(exercises);
  const allComplete =
    stats.totalExercises > 0 && exercises.every(isExerciseComplete);
  const nextIncompleteIndex = exercises.findIndex(
    e => !isExerciseComplete(e),
  );
  const nextExerciseId =
    nextIncompleteIndex >= 0 ? exercises[nextIncompleteIndex].exerciseId : null;
  const todayLabel = useMemo(() => format(new Date(), 'EEE, MMM d'), []);

  const onFinish = () => {
    navigation.navigate('WorkoutSummary');
  };

  // One stable reference for the whole exercise list, rather than a fresh
  // closure per row per render — required for WorkoutExerciseRow's memo to
  // actually skip unaffected rows.
  const handleExercisePress = useCallback(
    (exerciseId: string) => navigation.navigate('ActiveExercise', { exerciseId }),
    [navigation],
  );

  const onDeleteWorkout = () => {
    setOptionsSheetOpen(false);
    Alert.alert(
      'Delete this workout?',
      "This can't be undone — every set logged so far will be deleted too.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!workoutLogId) return;
            try {
              await deleteWorkoutLog.mutateAsync(workoutLogId);
            } catch (err) {
              Alert.alert(
                'Could not delete workout',
                err instanceof Error ? err.message : 'Please try again.',
              );
              return;
            }
            // A workout started from a rest day you'd scheduled one-off
            // (as opposed to a recurring program day) leaves behind the
            // scheduled_workouts row that created it — without this, "Add
            // Workout" for that day reappears with a Start button pointing
            // at a session that no longer exists.
            if (routeSource?.type === 'scheduledWorkout') {
              deleteScheduledWorkout.mutate(routeSource.id);
            }
            resetActiveWorkout();
            navigation.popToTop();
            rootNavigation.navigate('MainTabs', {
              screen: 'TodayTab',
              params: { screen: 'Today' },
            });
          },
        },
      ],
    );
  };

  if (routeSource == null && !shouldAutoStart) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: theme.colors.bg.base,
          padding: theme.spacing.lg,
          justifyContent: 'center',
          gap: theme.spacing.md,
        }}
      >
        <Card
          variant="elevated"
          style={{
            gap: theme.spacing.md,
            alignItems: 'center',
            paddingVertical: theme.spacing.xl,
          }}
        >
          <Text variant="title">Log a Workout</Text>
          <Text
            variant="body"
            color="secondary"
            style={{ textAlign: 'center' }}
          >
            Start a freestyle session and add exercises as you go.
          </Text>
          <View style={{ width: '100%' }}>
            <Button
              label="Start Freestyle Workout"
              onPress={() => setFreestyleStarted(true)}
            />
          </View>
        </Card>
        <Button
          label="Browse Exercise Library"
          variant="secondary"
          onPress={() => navigation.navigate('ExercisePicker')}
        />
        <Button
          label="Browse Workout Library"
          variant="secondary"
          onPress={() => navigation.navigate('Library')}
        />
      </SafeAreaView>
    );
  }

  if (
    dayLoading ||
    scheduledLoading ||
    templateLoading ||
    (needsFreshStart && !readyToStart) ||
    workoutLogId == null
  ) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
        <LoadingState />
      </SafeAreaView>
    );
  }

  const workoutTitle =
    programDay?.title ??
    scheduledWorkout?.name ??
    template?.name ??
    'Freestyle Workout';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <ActiveWorkoutHeader
        title={workoutTitle}
        dateLabel={todayLabel}
        startedAt={startedAt}
        stats={stats}
        onOptionsPress={() => setOptionsSheetOpen(true)}
      />

      {acceptedAdaptationCount > 0 ? (
        <Pressable
          onPress={() =>
            Alert.alert(
              'Adapted for today',
              (workoutAdaptations ?? [])
                .filter(a => a.status === 'accepted')
                .map(a => `• ${a.reason}`)
                .join('\n'),
            )
          }
          style={{
            marginHorizontal: theme.spacing.lg,
            marginBottom: theme.spacing.sm,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.xs,
            backgroundColor: theme.colors.accent.subtle,
            borderRadius: theme.radii.sm,
            paddingVertical: theme.spacing.xs,
            paddingHorizontal: theme.spacing.sm,
          }}
        >
          <Icon name="zap" size="sm" color={theme.colors.accent.primary} />
          <Text variant="caption" color="secondary">
            Adapted for today — tap to view changes
          </Text>
        </Pressable>
      ) : null}

      {appliedVariant ? (
        <Pressable
          onPress={() =>
            Alert.alert(
              appliedVariant.label,
              appliedVariant.changes.map(c => `• ${c.reason}`).join('\n'),
            )
          }
          style={{
            marginHorizontal: theme.spacing.lg,
            marginBottom: theme.spacing.sm,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.xs,
            backgroundColor: theme.colors.accent.subtle,
            borderRadius: theme.radii.sm,
            paddingVertical: theme.spacing.xs,
            paddingHorizontal: theme.spacing.sm,
          }}
        >
          <Icon name="repeat" size="sm" color={theme.colors.accent.primary} />
          <Text variant="caption" color="secondary">
            Variant: {appliedVariant.label} — tap to view changes
          </Text>
        </Pressable>
      ) : null}

      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingTop: 0,
          gap: theme.spacing.sm,
          paddingBottom: theme.spacing.xxl,
        }}
      >
        <ReorderableExerciseList
          exercises={exercises}
          nextExerciseId={nextExerciseId}
          unitPref={unitPref}
          onNavigate={handleExercisePress}
          onReorder={reorderExercises}
        />

        <Button
          label="Add Exercise"
          variant="secondary"
          icon="plus"
          onPress={() =>
            navigation.navigate('ExercisePicker', { selectMode: true })
          }
        />
      </ScrollView>

      <View
        style={{
          padding: theme.spacing.lg,
          paddingBottom: theme.spacing.lg + TAB_BAR_FLOAT_FOOTPRINT,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border.subtle,
          backgroundColor: theme.colors.bg.base,
        }}
      >
        <Button
          label="Finish Workout"
          onPress={onFinish}
          disabled={!allComplete}
        />
      </View>

      <BottomSheet
        visible={optionsSheetOpen}
        onClose={() => setOptionsSheetOpen(false)}
        title="Workout options"
      >
        <ListRow
          title="Browse Exercise Library"
          icon="dumbbell"
          onPress={() => {
            setOptionsSheetOpen(false);
            navigation.navigate('ExercisePicker');
          }}
        />
        <ListRow
          title="Delete Workout"
          icon="trash"
          onPress={onDeleteWorkout}
          style={{
            borderTopWidth: 1,
            borderTopColor: theme.colors.border.subtle,
          }}
        />
      </BottomSheet>
    </SafeAreaView>
  );
}
