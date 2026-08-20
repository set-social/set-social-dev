import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View, Alert } from 'react-native';
import Animated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { differenceInDays } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import {
  Text,
  Card,
  Button,
  TextField,
  Icon,
  ListRow,
  BottomSheet,
  LoadingState,
  KeyboardAvoider,
  BetaBadge,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import {
  useActiveWorkoutStore,
  effectiveTotalSets,
  type LoggedSet,
  type SetMetric,
} from '../../store/activeWorkoutStore';
import { useCoachingRecommendationsPreferenceStore } from '../../store/coachingRecommendationsPreferenceStore';
import {
  useLogSet,
  useUpdateSet,
  useDeleteSet,
} from '../../services/api/queries/workoutLogs';
import {
  useReadinessContext,
  usePreviousExercisePerformance,
  useSaveSetRecommendation,
  useSaveExerciseSubstitution,
} from '../../services/api/queries/coaching';
import { useExercises } from '../../services/api/queries/exercises';
import {
  useProfile,
  useUpdateProfile,
} from '../../services/api/queries/profiles';
import {
  useLoggedSets,
  computePrEvents,
  estimateOneRepMax,
} from '../../services/api/queries/progress';
import {
  coachingEngine,
  type ExerciseSubstitution,
  type SetRecommendation,
} from '../../services/coaching';
import { FocusedExerciseHeader } from './FocusedExerciseHeader';
import { SpotifyNowPlayingBar } from './SpotifyNowPlayingBar';
import { ExerciseHistorySummary } from './ExerciseHistorySummary';
import { RestTimerBanner } from './RestTimerBanner';
import { PrBanner } from './PrBanner';
import { SpotRequestSentSheet, formatCountdown } from './SpotRequestSentSheet';
import { useRequestSpot, useSpotRequest } from '../../services/api/queries/spotRequests';
import {
  WorkoutSetRow,
  metricLabel,
  formatMetricValue,
  isSetPopulated,
} from './WorkoutSetRow';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import { formatWeight, unitLabel } from '../../utils/units';
import {
  exerciseRowToMetadata,
  formatEnumLabel,
} from '../../utils/exerciseMetadata';
import type { ProgramsStackParamList } from '../../navigation/types';
import type { EquipmentType, UnitPreference } from '../../types/database';
import type { IconName } from '../../components/core';

type Route = RouteProp<ProgramsStackParamList, 'ActiveExercise'>;
type Nav = NativeStackNavigationProp<ProgramsStackParamList>;

// The real-time PR banner needs an established history to compare against —
// without this, an athlete's very first sets of every exercise would all
// trivially "beat" a nonexistent prior best and celebrate constantly.
const MIN_DAYS_OF_DATA_FOR_PR_BANNER = 14;

const METRIC_OPTIONS: Array<{ value: SetMetric; label: string }> = [
  { value: 'weight_lb', label: 'Weight (lb)' },
  { value: 'weight_kg', label: 'Weight (kg)' },
  { value: 'weight_pct', label: 'Weight (%)' },
  { value: 'reps', label: 'Reps' },
  { value: 'time', label: 'Time' },
];

const RECOMMENDATION_ACTION_LABELS: Record<
  SetRecommendation['type'],
  { accept: string; ignore: string }
> = {
  increase_weight: { accept: 'Apply to next set', ignore: 'Ignore' },
  reduce_weight: { accept: 'Apply to next set', ignore: 'Ignore' },
  keep_weight: { accept: 'Apply to next set', ignore: 'Ignore' },
  adjust_reps: { accept: 'Apply to next set', ignore: 'Ignore' },
  increase_rest: { accept: 'Add rest', ignore: 'Ignore' },
  remove_last_set: { accept: 'Remove that set', ignore: 'Keep it' },
  stop_exercise: { accept: 'Stop this exercise', ignore: 'Continue anyway' },
};

const RECOMMENDATION_ICON: Record<SetRecommendation['type'], IconName> = {
  increase_weight: 'trendingUp',
  reduce_weight: 'trendingDown',
  keep_weight: 'check',
  adjust_reps: 'repeat',
  increase_rest: 'timer',
  remove_last_set: 'minus',
  stop_exercise: 'circleAlert',
};

function recommendationDetail(
  rec: SetRecommendation,
  unitPref: UnitPreference,
): string | null {
  switch (rec.type) {
    case 'increase_weight':
    case 'reduce_weight':
      return rec.recommendedLoadKg != null
        ? `Try ${formatWeight(rec.recommendedLoadKg, unitPref)}${unitLabel(
            unitPref,
          )} next set`
        : null;
    case 'keep_weight':
      return rec.recommendedReps != null
        ? `Repeat ${rec.recommendedReps} reps${
            rec.recommendedLoadKg != null
              ? ` @ ${formatWeight(rec.recommendedLoadKg, unitPref)}${unitLabel(
                  unitPref,
                )}`
              : ''
          }`
        : null;
    case 'adjust_reps':
      return rec.recommendedReps != null
        ? `Aim for ${rec.recommendedReps} reps next set`
        : null;
    case 'increase_rest':
      return rec.recommendedRestSeconds != null
        ? `Rest ${rec.recommendedRestSeconds}s before your next set`
        : null;
    case 'remove_last_set':
    case 'stop_exercise':
      return null;
  }
}

type PendingRecommendation = {
  recommendation: SetRecommendation;
  /** The draft set number it would apply to, if any remain. */
  nextSetNumber: number | null;
  /** The set number that was just completed, prompting this recommendation. */
  afterSetNumber: number;
};

/**
 * Focused, single-exercise entry screen. Reads and writes the same
 * `useActiveWorkoutStore` the overview reads — this screen holds no
 * editable workout data in local state, only ephemeral UI state (which
 * sheet is open, the pending coaching recommendation), so nothing is lost
 * by navigating away and the overview reflects every change immediately.
 */
export function ActiveExerciseScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();

  // The Notes field sits right at the bottom of this ScrollView, right
  // after "Add Set" — with nothing below it, there's no scroll room left to
  // bring it above the keyboard once focused (KeyboardAvoider's own push
  // isn't enough for a field this close to the content end). Same trailing
  // keyboard-height spacer WorkoutSummaryScreen uses for its own Notes
  // field, for the same reason.
  const keyboard = useAnimatedKeyboard();
  const keyboardSpacerStyle = useAnimatedStyle(() => ({
    height: keyboard.height.value,
  }));
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const userId = useAuthStore(state => state.userId);
  const unitPref = useUnitPreference();

  const workoutLogId = useActiveWorkoutStore(state => state.workoutLogId);
  const exercises = useActiveWorkoutStore(state => state.exercises);
  const addSet = useActiveWorkoutStore(state => state.addSet);
  const updateSetDraft = useActiveWorkoutStore(state => state.updateSetDraft);
  const markSetCompleted = useActiveWorkoutStore(
    state => state.markSetCompleted,
  );
  const markSetIncomplete = useActiveWorkoutStore(
    state => state.markSetIncomplete,
  );
  const removeSet = useActiveWorkoutStore(state => state.removeSet);
  const removeExercise = useActiveWorkoutStore(state => state.removeExercise);
  const setExerciseNotes = useActiveWorkoutStore(
    state => state.setExerciseNotes,
  );
  const setExerciseMetric = useActiveWorkoutStore(
    state => state.setExerciseMetric,
  );
  const setExerciseTargetSets = useActiveWorkoutStore(
    state => state.setExerciseTargetSets,
  );
  const substituteExercise = useActiveWorkoutStore(
    state => state.substituteExercise,
  );
  const startRestTimer = useActiveWorkoutStore(state => state.startRestTimer);
  const startSetTimer = useActiveWorkoutStore(state => state.startSetTimer);
  const stopSetTimer = useActiveWorkoutStore(state => state.stopSetTimer);
  const ignoredRecommendationExerciseIds = useActiveWorkoutStore(
    state => state.ignoredRecommendationExerciseIds,
  );
  const ignoreRecommendationsForExercise = useActiveWorkoutStore(
    state => state.ignoreRecommendationsForExercise,
  );
  const recommendationsEnabled = useCoachingRecommendationsPreferenceStore(
    state => state.recommendationsEnabled,
  );

  const exerciseIndex = exercises.findIndex(
    e => e.exerciseId === params.exerciseId,
  );
  const exercise = exerciseIndex >= 0 ? exercises[exerciseIndex] : undefined;

  const logSet = useLogSet();
  const updateSet = useUpdateSet();
  const deleteSet = useDeleteSet();
  const saveRecommendation = useSaveSetRecommendation();
  const saveSubstitution = useSaveExerciseSubstitution();
  const { data: previousPerformance } = usePreviousExercisePerformance(
    exercise?.exerciseId ?? null,
    workoutLogId,
  );
  const { data: profile } = useProfile(userId);
  const isPremium = profile?.is_premium ?? false;
  const updateProfile = useUpdateProfile(userId);
  const { data: allExercises } = useExercises('');
  const { data: loggedSets } = useLoggedSets(userId);
  const readinessContext = useReadinessContext(userId);
  const readinessBand = useMemo(
    () =>
      readinessContext.isLoading
        ? null
        : coachingEngine.evaluateReadiness(readinessContext.inputs).band,
    [readinessContext.isLoading, readinessContext.inputs],
  );

  const [optionsSheetOpen, setOptionsSheetOpen] = useState(false);
  const [metricSheetOpen, setMetricSheetOpen] = useState(false);
  const [swapSheetOpen, setSwapSheetOpen] = useState(false);
  const [selectedSubstitute, setSelectedSubstitute] =
    useState<ExerciseSubstitution | null>(null);
  const [pending, setPending] = useState<PendingRecommendation | null>(null);
  const [prBannerTrigger, setPrBannerTrigger] = useState(0);
  // Split from `spotSheetVisible` deliberately — dismissing the sheet with
  // "OK" (or the backdrop/drag) must NOT forget the request, since it's
  // still pending in the background; only stops being "the current request"
  // once it actually resolves/expires (see isSpotRequestActive below) or a
  // fresh one replaces it.
  const [spotRequestId, setSpotRequestId] = useState<string | null>(null);
  const [spotSheetVisible, setSpotSheetVisible] = useState(false);
  const requestSpot = useRequestSpot();
  const { data: activeSpotRequest } = useSpotRequest(spotRequestId, { poll: spotRequestId != null });
  // Local re-render driver for the button's own countdown label — ticks
  // regardless of whether the sheet is open, unlike SpotRequestSentSheet's
  // identical-purpose ticker, which only runs while it's visible.
  const [, forceSpotButtonTick] = useState(0);
  useEffect(() => {
    if (activeSpotRequest?.status !== 'pending') return;
    const interval = setInterval(() => forceSpotButtonTick(n => n + 1), 1000);
    return () => clearInterval(interval);
  }, [activeSpotRequest?.status]);
  const isSpotRequestActive =
    activeSpotRequest != null &&
    activeSpotRequest.status === 'pending' &&
    new Date(activeSpotRequest.expiresAt).getTime() > Date.now();

  // loggedSets is ordered oldest-first (see fetchLoggedSets), so its first
  // entry is the athlete's very first logged set ever.
  const hasEnoughHistoryForPrBanner =
    loggedSets != null &&
    loggedSets.length > 0 &&
    differenceInDays(new Date(), new Date(loggedSets[0].loggedAt)) >=
      MIN_DAYS_OF_DATA_FOR_PR_BANNER;

  // Best estimated 1RM logged for this exercise before the set just
  // completed — loggedSets is the historical (already-persisted) dataset, so
  // it never includes the in-flight set being checked against it.
  const bestPriorE1rm = (exerciseId: string): number => {
    let best = 0;
    for (const s of loggedSets ?? []) {
      if (s.exerciseId !== exerciseId || s.loadKg == null || s.loadKg <= 0)
        continue;
      const e1rm = estimateOneRepMax(s.loadKg, s.reps);
      if (e1rm > best) best = e1rm;
    }
    return best;
  };

  // The exercise this screen was opened for can disappear out from under it
  // (removed, or the workout itself was reset) — bail to the overview rather
  // than render a dead screen.
  useEffect(() => {
    if (!exercise) navigation.goBack();
  }, [exercise, navigation]);

  useEffect(() => {
    setPending(null);
    setSwapSheetOpen(false);
    setSelectedSubstitute(null);
    setOptionsSheetOpen(false);
  }, [params.exerciseId]);

  const personalRecord = useMemo(() => {
    if (!loggedSets || !exercise) return null;
    const events = computePrEvents(loggedSets).filter(
      e => e.exerciseId === exercise.exerciseId,
    );
    return events.length > 0 ? events[events.length - 1] : null;
  }, [loggedSets, exercise]);

  if (!exercise) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
        <LoadingState />
      </SafeAreaView>
    );
  }

  const canSwap = exercise.sets.every(s => !s.completed);
  const currentExerciseMeta = allExercises?.find(
    e => e.id === exercise.exerciseId,
  );
  const substitutions: ExerciseSubstitution[] = (() => {
    if (!currentExerciseMeta || !allExercises) return [];
    return coachingEngine.recommendExerciseSubstitution({
      exercise: exerciseRowToMetadata(currentExerciseMeta),
      candidates: allExercises.map(exerciseRowToMetadata),
      availableEquipment:
        (profile?.equipment_access as EquipmentType[] | undefined) ?? null,
      excludeEquipment: currentExerciseMeta.equipment,
    });
  })();

  const previousExercise =
    exerciseIndex > 0 ? exercises[exerciseIndex - 1] : null;
  const nextExercise =
    exerciseIndex < exercises.length - 1 ? exercises[exerciseIndex + 1] : null;
  const completedSets = exercise.sets.filter(s => s.completed).length;
  const totalSets = effectiveTotalSets(exercise);

  const onConfirmSwap = (scope: 'workout_only' | 'permanent') => {
    if (!selectedSubstitute || !currentExerciseMeta) return;
    substituteExercise(exercise.exerciseId, {
      exerciseId: selectedSubstitute.exerciseId,
      exerciseName: selectedSubstitute.exerciseName,
    });
    if (userId) {
      saveSubstitution.mutate({
        userId,
        workoutLogId,
        originalExerciseId: currentExerciseMeta.id,
        substitution: selectedSubstitute,
        scope,
      });
    }
    if (scope === 'permanent' && userId && profile) {
      const remaining = (profile.equipment_access ?? []).filter(
        e => e !== currentExerciseMeta.equipment,
      );
      updateProfile.mutate({ equipment_access: remaining });
    }
    setSwapSheetOpen(false);
    setSelectedSubstitute(null);
    // Follow the exercise's new identity rather than bouncing to the
    // overview — this is the same screen instance, just re-pointed.
    navigation.setParams({ exerciseId: selectedSubstitute.exerciseId });
  };

  const onRemoveSet = async (setRow: LoggedSet) => {
    if (setRow.dbId) {
      try {
        await deleteSet.mutateAsync(setRow.dbId);
      } catch {
        Alert.alert(
          'Could not remove set',
          'Check your connection and try again.',
        );
        return;
      }
    }
    removeSet(exercise.exerciseId, setRow.id);
  };

  const onRemoveExercise = () => {
    const hasData = exercise.sets.some(isSetPopulated);
    Alert.alert(
      `Remove ${exercise.exerciseName}?`,
      hasData
        ? 'This removes the exercise and every set logged for it from this workout — it can’t be undone.'
        : 'This removes the exercise from this workout.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const savedSets = exercise.sets.filter(s => s.dbId);
            await Promise.all(
              savedSets.map(s =>
                s.dbId
                  ? deleteSet.mutateAsync(s.dbId).catch(() => undefined)
                  : undefined,
              ),
            );
            removeExercise(exercise.exerciseId);
            navigation.goBack();
          },
        },
      ],
    );
  };

  // Keeps a completed set's persisted workout_log_sets row in sync when its
  // reps/weight/RPE are edited after the fact — completion no longer locks
  // the inputs, but onToggleSet only ever pushes reps/load/rpe to the
  // backend at the moment of completion, so post-completion edits need their
  // own write here or the DB copy (which history/PR queries read from)
  // would silently drift from what's shown in the active workout.
  const onChangeSet = (
    setRow: LoggedSet,
    patch: Partial<Pick<LoggedSet, 'reps' | 'loadKg' | 'rpe'>>,
  ) => {
    updateSetDraft(exercise.exerciseId, setRow.id, patch);
    if (setRow.completed && setRow.dbId) {
      const merged = { ...setRow, ...patch };
      updateSet.mutate({
        id: setRow.dbId,
        ...(merged.reps != null ? { reps: merged.reps } : {}),
        load_kg: merged.loadKg,
        rpe: merged.rpe,
      });
    }
  };

  // Copies this row's reps + weight into every later, not-yet-completed set
  // — a quick way to log a straight-sets scheme without re-typing the same
  // numbers each time. RPE is deliberately left alone (it varies set to set
  // even at identical reps/weight).
  const onFillDown = (fromSetRow: LoggedSet) => {
    const remaining = exercise.sets.filter(
      s => s.setNumber > fromSetRow.setNumber && !s.completed,
    );
    if (remaining.length === 0) return;
    const weightLabel =
      fromSetRow.loadKg != null
        ? ` @ ${formatMetricValue(
            fromSetRow.loadKg,
            exercise.metric,
          )}${metricLabel(exercise.metric)}`
        : '';
    Alert.alert(
      'Fill remaining sets?',
      `Copy ${fromSetRow.reps ?? '—'} reps${weightLabel} to the next ${
        remaining.length
      } set${remaining.length === 1 ? '' : 's'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Fill Down',
          onPress: () => {
            remaining.forEach(setRow =>
              onChangeSet(setRow, {
                reps: fromSetRow.reps,
                loadKg: fromSetRow.loadKg,
              }),
            );
          },
        },
      ],
    );
  };

  const canFillDown = (setRow: LoggedSet) =>
    (setRow.reps != null || setRow.loadKg != null) &&
    exercise.sets.some(s => s.setNumber > setRow.setNumber && !s.completed);

  const onToggleSet = async (setRow: LoggedSet) => {
    if (setRow.completed) {
      markSetIncomplete(exercise.exerciseId, setRow.id);
      if (setRow.dbId) updateSet.mutate({ id: setRow.dbId, completed: false });
      return;
    }
    if (!workoutLogId || !setRow.reps || setRow.reps <= 0) {
      Alert.alert('Enter reps', 'Reps must be a positive number.');
      return;
    }

    // Checking off a timed set stops its stopwatch automatically — the
    // athlete shouldn't have to separately tap Stop before completing the
    // set. Computed here (rather than relying on setRow.durationSeconds,
    // which only updates once the store re-renders this component) so the
    // very set being completed is logged with its real elapsed time.
    let durationSeconds = setRow.durationSeconds;
    if (setRow.timerStartedAt != null) {
      durationSeconds = Math.round((Date.now() - setRow.timerStartedAt) / 1000);
      stopSetTimer(exercise.exerciseId, setRow.id);
    }

    try {
      if (setRow.dbId) {
        await updateSet.mutateAsync({
          id: setRow.dbId,
          reps: setRow.reps,
          load_kg: setRow.loadKg,
          rpe: setRow.rpe,
          duration_seconds: durationSeconds,
          completed: true,
        });
        markSetCompleted(exercise.exerciseId, setRow.id, setRow.dbId);
      } else {
        const created = await logSet.mutateAsync({
          workout_log_id: workoutLogId,
          exercise_id: exercise.exerciseId,
          set_number: setRow.setNumber,
          reps: setRow.reps,
          load_kg: setRow.loadKg,
          rpe: setRow.rpe,
          duration_seconds: durationSeconds,
          is_warmup: setRow.isWarmup,
        });
        markSetCompleted(exercise.exerciseId, setRow.id, created.id);
      }
      startRestTimer(exercise.restSeconds ?? 90);

      if (!setRow.isWarmup) {
        if (
          hasEnoughHistoryForPrBanner &&
          setRow.loadKg != null &&
          setRow.loadKg > 0
        ) {
          const newE1rm = estimateOneRepMax(setRow.loadKg, setRow.reps);
          if (newE1rm > bestPriorE1rm(exercise.exerciseId)) {
            setPrBannerTrigger(t => t + 1);
          }
        }

        const updatedSets = exercise.sets.map(s =>
          s.id === setRow.id
            ? {
                ...s,
                completed: true,
                reps: setRow.reps,
                loadKg: setRow.loadKg,
                rpe: setRow.rpe,
              }
            : s,
        );
        const completedWorkingSets = updatedSets
          .filter(s => s.completed && !s.isWarmup)
          .sort((a, b) => a.setNumber - b.setNumber);
        const nextDraft = updatedSets
          .filter(s => !s.completed)
          .sort((a, b) => a.setNumber - b.setNumber)[0];
        const nextSetNumber = nextDraft ? nextDraft.setNumber : null;

        // Next-set weight/rep recommendations are a SetSocial Pro
        // feature (Adaptive Coaching Intelligence) — a free account just
        // logs sets manually with no auto-suggested banner, rather than
        // computing a recommendation it's not allowed to show. Also
        // suppressed entirely if the athlete has turned recommendations off
        // in Settings, or already dismissed one for this exercise this
        // workout (see ignoreRecommendationsForExercise below).
        const recommendationsAllowed =
          isPremium &&
          recommendationsEnabled &&
          !ignoredRecommendationExerciseIds.includes(exercise.exerciseId);
        const recommendation = recommendationsAllowed
          ? coachingEngine.recommendNextSet({
              target: {
                exerciseId: exercise.exerciseId,
                targetSets: exercise.targetSets ?? updatedSets.length,
                targetRepsMin: exercise.targetRepsMin ?? null,
                targetRepsMax: exercise.targetRepsMax ?? null,
                targetLoadKg: exercise.targetLoadKg ?? null,
                targetRpe: exercise.targetRpe ?? null,
                restSeconds: exercise.restSeconds ?? null,
              },
              completedSets: completedWorkingSets.map(s => ({
                setNumber: s.setNumber,
                reps: s.reps ?? 0,
                loadKg: s.loadKg,
                rpe: s.rpe,
              })),
              nextSetNumber,
              nextSetCurrentReps: nextDraft?.reps ?? null,
              nextSetCurrentLoadKg: nextDraft?.loadKg ?? null,
              readinessBand,
              unitPref,
            })
          : null;

        setPending(
          recommendation
            ? {
                recommendation,
                nextSetNumber,
                afterSetNumber: setRow.setNumber,
              }
            : null,
        );
      }
    } catch {
      Alert.alert(
        'Set not saved',
        'Could not save that set — check your connection and try again.',
      );
    }
  };

  const onRespondToRecommendation = async (accepted: boolean) => {
    if (!pending) return;
    const { recommendation: rec, nextSetNumber, afterSetNumber } = pending;

    if (accepted) {
      switch (rec.type) {
        case 'increase_weight':
        case 'reduce_weight':
        case 'keep_weight':
        case 'adjust_reps': {
          const target =
            nextSetNumber != null
              ? exercise.sets.find(
                  s => s.setNumber === nextSetNumber && !s.completed,
                )
              : undefined;
          if (target) {
            updateSetDraft(exercise.exerciseId, target.id, {
              reps: rec.recommendedReps ?? target.reps,
              loadKg: rec.recommendedLoadKg ?? target.loadKg,
            });
          }
          break;
        }
        case 'increase_rest':
          startRestTimer(
            rec.recommendedRestSeconds ?? exercise.restSeconds ?? 90,
          );
          break;
        case 'remove_last_set': {
          const target = exercise.sets.find(
            s => s.setNumber === afterSetNumber,
          );
          if (target) await onRemoveSet(target);
          break;
        }
        case 'stop_exercise': {
          const remaining = exercise.sets.filter(s => !s.completed);
          for (const setRow of remaining) {
            if (setRow.dbId) {
              try {
                await deleteSet.mutateAsync(setRow.dbId);
              } catch {
                // Best-effort — still remove it locally so the exercise reads as done.
              }
            }
            removeSet(exercise.exerciseId, setRow.id);
          }
          setExerciseTargetSets(exercise.exerciseId, afterSetNumber);
          break;
        }
      }
    } else {
      // Ignored — don't offer another recommendation for this exercise for
      // the rest of the workout.
      ignoreRecommendationsForExercise(exercise.exerciseId);
    }

    if (userId && workoutLogId) {
      saveRecommendation.mutate({
        userId,
        workoutLogId,
        exerciseId: exercise.exerciseId,
        afterSetNumber,
        recommendation: rec,
        accepted,
      });
    }
    setPending(null);
  };

  // The set actually worth mentioning in the request — whichever one isn't
  // done yet (that's the one about to need a spot), or the last set if
  // every one is already checked off (nothing left to ask about, but still
  // a sane fallback rather than sending no set context at all).
  const onRequestSpot = async () => {
    if (!userId) return;
    const targetSet = exercise.sets.find(s => !s.completed) ?? exercise.sets[exercise.sets.length - 1];
    try {
      const created = await requestSpot.mutateAsync({
        userId,
        workoutLogId,
        exerciseName: exercise.exerciseName,
        setNumber: targetSet?.setNumber ?? null,
        loadKg: targetSet?.loadKg ?? null,
      });
      setSpotRequestId(created.id);
      setSpotSheetVisible(true);
    } catch (err) {
      Alert.alert(
        'Could not send request',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  };

  // A request already in flight (pending, unexpired) means there's nothing
  // new to send — re-opens the same sheet (with its live status/Cancel)
  // instead of firing off a second request on top of the first.
  const onSpotButtonPress = () => {
    if (isSpotRequestActive) {
      setSpotSheetVisible(true);
    } else {
      onRequestSpot();
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <SpotifyNowPlayingBar />
      <FocusedExerciseHeader
        exerciseName={exercise.exerciseName}
        exerciseNumber={exerciseIndex + 1}
        totalExercises={exercises.length}
        completedSets={completedSets}
        totalSets={totalSets}
        onBack={() => navigation.goBack()}
        onPrevious={
          previousExercise
            ? () =>
                navigation.setParams({
                  exerciseId: previousExercise.exerciseId,
                })
            : undefined
        }
        onNext={
          nextExercise
            ? () =>
                navigation.setParams({ exerciseId: nextExercise.exerciseId })
            : undefined
        }
        onOptionsPress={() => setOptionsSheetOpen(true)}
      />

      <View style={{ flex: 1, position: 'relative' }}>
        {/* Anchored below the header (not the SafeAreaView's top edge) so it
            never overlaps the status bar / Dynamic Island. */}
        <PrBanner trigger={prBannerTrigger} />
        <KeyboardAvoider>
          <ScrollView
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              padding: theme.spacing.lg,
              paddingTop: 0,
              paddingBottom: theme.spacing.lg + tabBarHeight,
              gap: theme.spacing.lg,
            }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Pressable
              onPress={onSpotButtonPress}
              disabled={requestSpot.isPending}
              accessibilityRole="button"
              accessibilityLabel={isSpotRequestActive ? 'View spot request status' : 'Request a spot'}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignSelf: 'flex-start',
                alignItems: 'center',
                gap: theme.spacing.xs,
                paddingVertical: 7,
                paddingHorizontal: 12,
                borderRadius: theme.radii.pill,
                backgroundColor: theme.colors.accent.subtle,
                borderWidth: 1,
                borderColor: theme.colors.accent.primary,
                opacity: pressed || requestSpot.isPending ? 0.7 : 1,
              })}
            >
              <Icon
                name={isSpotRequestActive ? 'clock' : 'dumbbell'}
                size="sm"
                color={theme.colors.accent.primary}
              />
              <Text variant="caption" style={{ color: theme.colors.accent.primary, fontWeight: '700' }}>
                {isSpotRequestActive && activeSpotRequest
                  ? `Requested · ${formatCountdown(new Date(activeSpotRequest.expiresAt).getTime() - Date.now())}`
                  : 'Request a Spot'}
              </Text>
            </Pressable>

            <ExerciseHistorySummary
              exercise={exercise}
              previousPerformance={previousPerformance}
              personalRecord={personalRecord}
              unitPref={unitPref}
            />

            <RestTimerBanner />

            {pending ? (
              <Card variant="subtle" style={{ gap: theme.spacing.sm }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                  }}
                >
                  <Icon
                    name={RECOMMENDATION_ICON[pending.recommendation.type]}
                    size="sm"
                    color={theme.colors.accent.primary}
                  />
                  <Text variant="body" style={{ flex: 1, fontWeight: '700' }}>
                    {recommendationDetail(pending.recommendation, unitPref) ??
                      "Arnold's suggestion"}
                  </Text>
                </View>
                <Text variant="caption" color="secondary">
                  {pending.recommendation.reason}
                </Text>
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={
                        RECOMMENDATION_ACTION_LABELS[
                          pending.recommendation.type
                        ].accept
                      }
                      size="sm"
                      onPress={() => onRespondToRecommendation(true)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={
                        RECOMMENDATION_ACTION_LABELS[
                          pending.recommendation.type
                        ].ignore
                      }
                      variant="ghost"
                      size="sm"
                      onPress={() => onRespondToRecommendation(false)}
                    />
                  </View>
                </View>
              </Card>
            ) : null}

            <View style={{ gap: theme.spacing.sm }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                }}
              >
                <View style={{ width: 44 }} />
                <Text variant="label" color="secondary" style={{ width: 36 }} />
                <Text variant="label" color="secondary" style={{ flex: 1 }}>
                  REPS
                </Text>
                <Pressable
                  onPress={() => setMetricSheetOpen(true)}
                  accessibilityLabel={`Change tracked metric, currently ${metricLabel(
                    exercise.metric,
                  )}`}
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.xxs,
                  }}
                >
                  <Text variant="label" color="secondary">
                    {metricLabel(exercise.metric)}
                  </Text>
                  <Icon
                    name="chevronDown"
                    size="sm"
                    color={theme.colors.text.tertiary}
                  />
                </Pressable>
                <Text variant="label" color="secondary" style={{ flex: 1 }}>
                  RPE
                </Text>
                <View style={{ width: 44 }} />
              </View>

              {exercise.sets.map(setRow => (
                <WorkoutSetRow
                  key={setRow.id}
                  setRow={setRow}
                  metric={exercise.metric}
                  onToggle={() => onToggleSet(setRow)}
                  onRemove={() => onRemoveSet(setRow)}
                  onChange={patch => onChangeSet(setRow, patch)}
                  onStartTimer={() =>
                    startSetTimer(exercise.exerciseId, setRow.id)
                  }
                  onStopTimer={() =>
                    stopSetTimer(exercise.exerciseId, setRow.id)
                  }
                  onFillDown={
                    canFillDown(setRow) ? () => onFillDown(setRow) : undefined
                  }
                />
              ))}
            </View>

            <Button
              label="Add Set"
              variant="secondary"
              onPress={() => addSet(exercise.exerciseId)}
            />

            <TextField
              label="Notes (optional)"
              value={exercise.notes}
              onChangeText={text => setExerciseNotes(exercise.exerciseId, text)}
              placeholder="How did this exercise feel?"
              multiline
            />

            <Animated.View style={keyboardSpacerStyle} />
          </ScrollView>
        </KeyboardAvoider>
      </View>

      <BottomSheet
        visible={optionsSheetOpen}
        onClose={() => setOptionsSheetOpen(false)}
        title={exercise.exerciseName}
      >
        <View style={{ gap: theme.spacing.xs }}>
          <ListRow
            title="View exercise details"
            icon="info"
            onPress={() => {
              setOptionsSheetOpen(false);
              navigation.navigate('ExerciseDetail', {
                exerciseId: exercise.exerciseId,
              });
            }}
          />
          <ListRow
            title="Check My Form"
            icon="camera"
            trailing={<BetaBadge />}
            onPress={() => {
              setOptionsSheetOpen(false);
              navigation.navigate('FormCheck', {
                exerciseId: exercise.exerciseId,
                exerciseName: exercise.exerciseName,
              });
            }}
          />
          {canSwap ? (
            <ListRow
              title="Find a substitute exercise"
              icon="repeat"
              onPress={() => {
                setOptionsSheetOpen(false);
                setSwapSheetOpen(true);
              }}
            />
          ) : null}
          <ListRow
            title="Remove exercise from workout"
            icon="trash"
            onPress={() => {
              setOptionsSheetOpen(false);
              onRemoveExercise();
            }}
          />
        </View>
      </BottomSheet>

      <BottomSheet
        visible={metricSheetOpen}
        onClose={() => setMetricSheetOpen(false)}
        title="Track this exercise by"
      >
        <View style={{ gap: theme.spacing.xs }}>
          {METRIC_OPTIONS.map(option => (
            <ListRow
              key={option.value}
              title={option.label}
              onPress={() => {
                setExerciseMetric(exercise.exerciseId, option.value);
                setMetricSheetOpen(false);
              }}
              trailing={
                exercise.metric === option.value ? (
                  <Icon
                    name="check"
                    size="sm"
                    color={theme.colors.accent.primary}
                  />
                ) : null
              }
            />
          ))}
        </View>
      </BottomSheet>

      <BottomSheet
        visible={swapSheetOpen}
        onClose={() => {
          setSwapSheetOpen(false);
          setSelectedSubstitute(null);
        }}
        title="Find a substitute"
      >
        <View style={{ gap: theme.spacing.md }}>
          {substitutions.length === 0 ? (
            <Text variant="body" color="secondary">
              No close substitute in the library yet.
            </Text>
          ) : (
            <View style={{ gap: theme.spacing.xs }}>
              {substitutions.map(substitution => (
                <ListRow
                  key={substitution.exerciseId}
                  title={substitution.exerciseName}
                  subtitle={substitution.reason}
                  onPress={() => setSelectedSubstitute(substitution)}
                  trailing={
                    selectedSubstitute?.exerciseId ===
                    substitution.exerciseId ? (
                      <Icon
                        name="check"
                        size="sm"
                        color={theme.colors.accent.primary}
                      />
                    ) : null
                  }
                />
              ))}
            </View>
          )}

          {selectedSubstitute ? (
            <View style={{ gap: theme.spacing.sm }}>
              <Button
                label="Swap for this workout"
                onPress={() => onConfirmSwap('workout_only')}
              />
              {currentExerciseMeta ? (
                <Button
                  label={`Swap + remove ${formatEnumLabel(
                    currentExerciseMeta.equipment,
                  )} from my equipment`}
                  variant="secondary"
                  onPress={() => onConfirmSwap('permanent')}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      </BottomSheet>

      <SpotRequestSentSheet
        visible={spotSheetVisible}
        onClose={() => setSpotSheetVisible(false)}
        requestId={spotRequestId}
        exerciseName={exercise.exerciseName}
        setNumber={
          (exercise.sets.find(s => !s.completed) ?? exercise.sets[exercise.sets.length - 1])?.setNumber ?? null
        }
        loadKg={
          (exercise.sets.find(s => !s.completed) ?? exercise.sets[exercise.sets.length - 1])?.loadKg ?? null
        }
      />
    </SafeAreaView>
  );
}
