import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import LinearGradient from 'react-native-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import {
  Text,
  Card,
  Button,
  TextField,
  SegmentedControl,
  StatTile,
  Icon,
  LoadingState,
  KeyboardAvoider,
} from '../../components/core';
import {
  useActiveWorkoutStore,
  computeWorkoutStats,
  type ActiveExercise,
} from '../../store/activeWorkoutStore';
import { useAuthStore } from '../../store/authStore';
import { useCompleteWorkoutLog } from '../../services/api/queries/workoutLogs';
import { useSyncCompletedWorkoutToTemplate } from '../../services/api/queries/templateProgression';
import { useSaveCoachingSummary } from '../../services/api/queries/coachingHistory';
import { featureFlags } from '../../config/featureFlags';
import { CoachingSummaryCards } from './CoachingSummaryCards';
import {
  useLoggedSets,
  computePrEvents,
} from '../../services/api/queries/progress';
import {
  usePreviousPerformanceForExercises,
  useReadinessContext,
} from '../../services/api/queries/coaching';
import { useProfile } from '../../services/api/queries/profiles';
import { useLatestBodyWeight } from '../../services/api/queries/bodyMetrics';
import {
  coachingEngine,
  type PostWorkoutSummaryResult,
} from '../../services/coaching';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import { estimateStrengthSessionCalories } from '../../utils/energyBalance';
import type { RootStackParamList } from '../../navigation/types';

type RootNav = NativeStackNavigationProp<RootStackParamList>;

const RATING_OPTIONS = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5', label: '5' },
];

function formatElapsed(startedAt: number | null): string {
  if (!startedAt) return '0:00';
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - startedAt) / 1000),
  );
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Per-exercise notes have nowhere of their own in the schema, so they're
 * folded into the single workout_logs.notes field ahead of the athlete's
 * own summary notes rather than adding a new column. */
function buildNotes(
  exercises: ActiveExercise[],
  summaryNotes: string,
): string | undefined {
  const exerciseNotes = exercises
    .filter(e => e.notes.trim())
    .map(e => `${e.exerciseName}: ${e.notes.trim()}`)
    .join('\n');
  const combined = [exerciseNotes, summaryNotes.trim()]
    .filter(Boolean)
    .join('\n\n');
  return combined || undefined;
}

export function WorkoutSummaryScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const rootNavigation = useNavigation<RootNav>();
  // Individual selectors rather than `useActiveWorkoutStore()` — this screen
  // only reads a handful of fields, and a whole-store subscription would
  // otherwise still re-render for state changes (e.g. a stray rest-timer
  // tick) that have nothing to do with what's rendered here. Matches the
  // same fix on ActiveWorkoutOverviewScreen.
  const workoutLogId = useActiveWorkoutStore(state => state.workoutLogId);
  const source = useActiveWorkoutStore(state => state.source);
  const exercises = useActiveWorkoutStore(state => state.exercises);
  const startedAt = useActiveWorkoutStore(state => state.startedAt);
  const resetActiveWorkout = useActiveWorkoutStore(state => state.reset);
  const completeWorkoutLog = useCompleteWorkoutLog();
  const syncToTemplate = useSyncCompletedWorkoutToTemplate();
  const saveCoachingSummary = useSaveCoachingSummary();
  const unitPref = useUnitPreference();
  const userId = useAuthStore(state => state.userId);

  const [rating, setRating] = useState('');
  const [rpe, setRpe] = useState('');
  const [notes, setNotes] = useState('');

  // The Notes field sits right at the bottom of a long ScrollView, right
  // above the Save button — with nothing below it, there's no scroll room
  // left to bring it above the keyboard once focused (KeyboardAvoider's own
  // push isn't enough on iOS for a field this close to the content end). A
  // trailing spacer sized to the live keyboard height guarantees there's
  // always room to scroll it fully clear, on both platforms.
  const keyboard = useAnimatedKeyboard();
  const keyboardSpacerStyle = useAnimatedStyle(() => ({
    height: keyboard.height.value,
  }));

  // Captured once on mount — the workout is already over, so this shouldn't
  // keep ticking the way the in-progress elapsed label on the Active Workout
  // screen does. Same source as totalTime above, just as raw minutes instead
  // of a formatted label — feeds the calorie estimate below.
  const [totalTime] = useState(() => formatElapsed(startedAt));
  const [durationMinutes] = useState(() =>
    startedAt ? Math.max(0, (Date.now() - startedAt) / 60_000) : 0,
  );
  const stats = computeWorkoutStats(exercises);

  const { data: profile } = useProfile(userId);
  const { data: latestWeightKg } = useLatestBodyWeight(userId);
  const { data: loggedSets } = useLoggedSets(userId);
  const exerciseIds = exercises.map(e => e.exerciseId);
  const { data: previousPerformance } = usePreviousPerformanceForExercises(
    exerciseIds,
    workoutLogId,
  );
  const readinessContext = useReadinessContext(userId);

  // Computed from `exercises` while it's still in memory — onSave() resets
  // the store, which would otherwise wipe this data before it's shown.
  const coachingSummary = useMemo<PostWorkoutSummaryResult | null>(() => {
    if (!loggedSets || !previousPerformance || readinessContext.isLoading)
      return null;

    const sessionPrEvents = computePrEvents(loggedSets).filter(
      e =>
        startedAt != null &&
        new Date(e.loggedAt).getTime() >= startedAt,
    );
    const readiness = coachingEngine.evaluateReadiness(readinessContext.inputs);
    const checkin = readinessContext.inputs.checkin;
    const painRisk = coachingEngine.assessPainRisk(
      checkin?.hasPain ?? false,
      checkin?.painNotes ?? null,
    );

    const previousVolumeByExercise: Record<string, number> = {};
    const previousBestE1rmByExercise: Record<string, number> = {};
    for (const [exerciseId, perf] of Object.entries(previousPerformance)) {
      previousVolumeByExercise[exerciseId] = perf.volumeKg;
      previousBestE1rmByExercise[exerciseId] = perf.bestE1rm;
    }

    return coachingEngine.generatePostWorkoutSummary({
      exercises: exercises.map(e => ({
        exerciseId: e.exerciseId,
        exerciseName: e.exerciseName,
        targetRpe: e.targetRpe ?? null,
        sets: e.sets
          .filter(s => s.completed && !s.isWarmup)
          .map(s => ({ reps: s.reps ?? 0, loadKg: s.loadKg, rpe: s.rpe })),
      })),
      previousVolumeByExercise,
      previousBestE1rmByExercise,
      sessionPrEvents,
      readiness,
      trainingLoad: readinessContext.inputs.trainingLoad,
      painRisk,
      unitPref,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    loggedSets,
    previousPerformance,
    readinessContext.isLoading,
    readinessContext.inputs,
    unitPref,
  ]);

  // MET x bodyweight x duration, with this session's own total volume
  // picking a lighter/heavier effort tier — see estimateStrengthSessionCalories.
  // Requires bodyweight at minimum; sex sharpens the estimate further and
  // age/height factor into `hasEnoughProfileData`-style completeness the
  // same way Energy Today already caveats an incomplete profile. Null (not
  // 0) when weight is unknown, so the UI can show "—" instead of a wrong 0.
  const estimatedCalories = useMemo(() => {
    if (latestWeightKg == null || durationMinutes <= 0) return null;
    return estimateStrengthSessionCalories({
      durationMinutes,
      weightKg: latestWeightKg,
      sex: profile?.sex,
      volumeKg: coachingSummary?.totalVolumeKg,
    });
  }, [latestWeightKg, durationMinutes, profile?.sex, coachingSummary?.totalVolumeKg]);
  const hasFullBodyProfile =
    latestWeightKg != null && profile?.height_cm != null && profile?.birth_date != null && profile?.sex != null;

  const onSave = async () => {
    if (!workoutLogId) return;
    try {
      await completeWorkoutLog.mutateAsync({
        workoutLogId,
        overallRpe: rpe ? parseFloat(rpe) : undefined,
        notes: buildNotes(exercises, notes),
        rating: rating ? Number(rating) : undefined,
        estimatedCalories,
      });
    } catch (err) {
      Alert.alert(
        'Could not save workout',
        err instanceof Error ? err.message : 'Please try again.',
      );
      return;
    }
    // Best-effort — see docs/coaching-history.md. A failed write here means
    // this one workout has no Coaching History entry, not a broken save;
    // the workout log itself already saved successfully above, so this
    // never blocks the rest of onSave or shows an error of its own.
    if (userId && featureFlags.coachingHistory && coachingSummary) {
      saveCoachingSummary
        .mutateAsync({ userId, workoutLogId, summary: coachingSummary })
        .catch(err => console.error('failed to save coaching summary', err));
    }
    // Carries this session's actual sets/reps/weight back into the
    // recurring template it came from (e.g. an extra set added to Tuesday's
    // arm day shows up again next Tuesday) — never rejects, so no try/catch
    // needed here; must run before resetActiveWorkout() clears the data it reads.
    await syncToTemplate.mutateAsync({
      source,
      exercises,
    });
    resetActiveWorkout();
    // rootNavigation is this screen's nearest navigator — ProgramsStack,
    // since WorkoutSummary lives on it — so popToTop() here clears
    // ActiveWorkoutOverview/ActiveExercise back to Calendar before leaving.
    // Without it those screens stay mounted underneath with their original
    // route target still in place, and the Training tab reopens straight
    // back into them instead of the calendar view.
    rootNavigation.popToTop();
    rootNavigation.navigate('MainTabs', {
      screen: 'TodayTab',
      params: { screen: 'Today' },
    });
  };

  if (!workoutLogId) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: theme.colors.bg.base,
          padding: theme.spacing.xl,
          justifyContent: 'center',
          gap: theme.spacing.md,
        }}
      >
        <Text variant="title">No active workout</Text>
        <Button
          label="Back to Today"
          onPress={() =>
            rootNavigation.navigate('MainTabs', {
              screen: 'TodayTab',
              params: { screen: 'Today' },
            })
          }
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <KeyboardAvoider>
        <ScrollView
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            padding: theme.spacing.xl,
            paddingBottom: theme.spacing.xl + tabBarHeight,
            gap: theme.spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View>
            <LinearGradient
              colors={[...theme.gradients.accent]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                width: 48,
                height: 48,
                borderRadius: theme.radii.lg,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: theme.spacing.sm,
              }}
            >
              <Icon
                name="partyPopper"
                size="lg"
                color={theme.colors.text.onAccent}
              />
            </LinearGradient>
            <Text variant="title">Workout complete</Text>
            <Text variant="body" color="secondary">
              Nice work. Log how it went before you save it.
            </Text>
          </View>

          {!coachingSummary ? (
            <LoadingState fill={false} label="Putting your summary together…" />
          ) : (
            <CoachingSummaryCards summary={coachingSummary} unitPref={unitPref} />
          )}

          <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            <View style={{ flex: 1 }}>
              <StatTile label="Total Time" value={totalTime} />
            </View>
            <View style={{ flex: 1 }}>
              <StatTile
                label="Exercises"
                value={`${stats.completedExercises}/${stats.totalExercises}`}
              />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            <View style={{ flex: 1 }}>
              <StatTile label="Sets" value={stats.totalSets} />
            </View>
            <View style={{ flex: 1 }}>
              <StatTile label="Reps" value={stats.totalReps} />
            </View>
          </View>
          <View style={{ gap: theme.spacing.xs }}>
            <StatTile
              label="Est. Calorie Burn"
              value={estimatedCalories != null ? `${estimatedCalories} cal` : '—'}
            />
            {!hasFullBodyProfile ? (
              <Text variant="caption" color="tertiary">
                Add your height, weight, age and sex in Stats → Body Metrics
                for a more accurate number.
              </Text>
            ) : null}
          </View>

          <Card variant="elevated" style={{ gap: theme.spacing.md }}>
            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="label" color="secondary">
                WORKOUT RATING — HOW DID IT FEEL?
              </Text>
              <SegmentedControl
                options={RATING_OPTIONS}
                value={rating}
                onChange={setRating}
              />
            </View>

            <TextField
              label="Performance Rating (RPE)"
              keyboardType="decimal-pad"
              value={rpe}
              onChangeText={setRpe}
              placeholder="8"
            />

            <TextField
              label="Notes (optional)"
              value={notes}
              onChangeText={setNotes}
              placeholder="How did the session go?"
              multiline
            />
          </Card>

          <Button
            label="Save Workout"
            onPress={onSave}
            loading={completeWorkoutLog.isPending}
          />

          <Animated.View style={keyboardSpacerStyle} />
        </ScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}
