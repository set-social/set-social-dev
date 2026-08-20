import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
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
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import {
  Text,
  Card,
  Button,
  Header,
  SegmentedControl,
  TextField,
  ListRow,
  ProgressRing,
  LoadingState,
  Icon,
  KeyboardAvoider,
  LockedFeatureCard,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useProfile } from '../../services/api/queries/profiles';
import { useProgramDay } from '../../services/api/queries/programs';
import { useScheduledWorkout } from '../../services/api/queries/scheduledWorkouts';
import {
  useReadinessContext,
  useSubmitReadinessCheckin,
  useWorkoutAdaptations,
  useSaveWorkoutAdaptations,
} from '../../services/api/queries/coaching';
import {
  coachingEngine,
  type AdaptationChange,
  type AdaptationExerciseTarget,
} from '../../services/coaching';
import { trackEvent } from '../../services/analytics/analytics';
import { getErrorMessage } from '../../utils/errors';
import type {
  ProgramsStackParamList,
  RootStackParamList,
} from '../../navigation/types';

type Route = RouteProp<ProgramsStackParamList, 'PreWorkoutReview'>;
type Nav = NativeStackNavigationProp<ProgramsStackParamList>;
type RootNav = NativeStackNavigationProp<RootStackParamList>;

// Exported so QuickCheckinCard's confirm step (the NL check-in's
// human-review step before saving) renders the exact same rating scale and
// pain options as this manual form, rather than a second definition that
// could drift out of sync.
export const RATING_OPTIONS = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5', label: '5' },
];
export const PAIN_OPTIONS: Array<{ value: 'yes' | 'no'; label: string }> = [
  { value: 'no', label: 'No pain' },
  { value: 'yes', label: 'Pain today' },
];

type ExerciseTargetWithName = AdaptationExerciseTarget & {
  exerciseName: string;
};

export function PreWorkoutReviewScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();

  // The pain-notes field can end up as the last thing in this ScrollView
  // (once toggled on, it's followed only by the two submit/skip buttons) —
  // same "not enough scroll room to clear the keyboard" issue
  // WorkoutSummaryScreen's Notes field has, fixed the same way.
  const keyboard = useAnimatedKeyboard();
  const keyboardSpacerStyle = useAnimatedStyle(() => ({
    height: keyboard.height.value,
  }));

  const navigation = useNavigation<Nav>();
  const rootNavigation = useNavigation<RootNav>();
  const { params } = useRoute<Route>();
  const userId = useAuthStore(state => state.userId);
  const { data: profile } = useProfile(userId);
  const isPremium = profile?.is_premium ?? false;

  const { data: programDay, isLoading: programDayLoading } = useProgramDay(
    params.programDayId,
  );
  const { data: scheduledWorkout, isLoading: scheduledLoading } =
    useScheduledWorkout(params.scheduledWorkoutId);

  const readinessContext = useReadinessContext(userId);
  const submitCheckin = useSubmitReadinessCheckin(userId);
  const existingAdaptations = useWorkoutAdaptations(userId, {
    programDayId: params.programDayId,
    scheduledWorkoutId: params.scheduledWorkoutId,
  });
  const saveAdaptations = useSaveWorkoutAdaptations();

  const [skippedCheckin, setSkippedCheckin] = useState(false);
  const [sleepHours, setSleepHours] = useState('');
  const [sleepQuality, setSleepQuality] = useState<string>('3');
  const [soreness, setSoreness] = useState<string>('3');
  const [stress, setStress] = useState<string>('3');
  const [painToggle, setPainToggle] = useState<'yes' | 'no'>('no');
  const [painNotes, setPainNotes] = useState('');
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});

  const exerciseTargets = useMemo<ExerciseTargetWithName[]>(() => {
    if (programDay) {
      return programDay.program_exercises.map(pe => ({
        exerciseId: pe.exercise_id,
        exerciseName: pe.exercises.name,
        targetSets: pe.target_sets,
        targetRepsMin: pe.target_reps_min,
        targetRepsMax: pe.target_reps_max,
        targetLoadKg: pe.target_load_kg,
        targetRpe: pe.target_rpe,
        restSeconds: pe.rest_seconds,
      }));
    }
    if (scheduledWorkout) {
      return scheduledWorkout.scheduled_workout_exercises.map(se => ({
        exerciseId: se.exercise_id,
        exerciseName: se.exercises.name,
        targetSets: se.target_sets,
        targetRepsMin: se.target_reps_min,
        targetRepsMax: se.target_reps_max,
        targetLoadKg: se.target_load_kg,
        targetRpe: se.target_rpe,
        restSeconds: se.rest_seconds,
      }));
    }
    return [];
  }, [programDay, scheduledWorkout]);

  const exerciseNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const ex of exerciseTargets) map.set(ex.exerciseId, ex.exerciseName);
    return map;
  }, [exerciseTargets]);

  const hasExistingReview = (existingAdaptations.data?.length ?? 0) > 0;
  const isLoading =
    programDayLoading ||
    scheduledLoading ||
    readinessContext.isLoading ||
    existingAdaptations.isLoading;
  const showCheckinForm =
    !isLoading &&
    !readinessContext.hasCheckin &&
    !skippedCheckin &&
    !hasExistingReview;

  const readiness = useMemo(() => {
    if (isLoading || showCheckinForm) return null;
    return coachingEngine.evaluateReadiness(readinessContext.inputs);
  }, [isLoading, showCheckinForm, readinessContext.inputs]);

  const painRisk = useMemo(() => {
    const checkin = readinessContext.inputs.checkin;
    return coachingEngine.assessPainRisk(
      checkin?.hasPain ?? false,
      checkin?.painNotes ?? null,
    );
  }, [readinessContext.inputs.checkin]);

  // Adaptive Coaching Intelligence (auto readiness-based adjustments) is a
  // SetSocial Pro feature — gated at the source, not just in the UI
  // below, so a free account's onStartWorkout (which reads this same memo)
  // can never end up silently applying/saving an adaptation either.
  const proposedAdaptations = useMemo<AdaptationChange[]>(() => {
    if (
      !readiness ||
      hasExistingReview ||
      exerciseTargets.length === 0 ||
      !isPremium
    )
      return [];
    return coachingEngine.adaptScheduledWorkout({
      exercises: exerciseTargets,
      readiness,
      painRisk,
    });
  }, [readiness, painRisk, exerciseTargets, hasExistingReview, isPremium]);

  useEffect(() => {
    if (proposedAdaptations.length === 0) return;
    setDecisions(prev => {
      const next = { ...prev };
      let changed = false;
      for (const change of proposedAdaptations) {
        if (!(change.id in next)) {
          next[change.id] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [proposedAdaptations]);

  useEffect(() => {
    if (readiness) {
      trackEvent('readiness_viewed', {
        band: readiness.band,
        score: readiness.score,
      });
    }
  }, [readiness]);

  useEffect(() => {
    if (proposedAdaptations.length > 0) {
      trackEvent('workout_adapted', { count: proposedAdaptations.length });
    }
  }, [proposedAdaptations]);

  const onSubmitCheckin = async () => {
    try {
      await submitCheckin.mutateAsync({
        sleepHours: sleepHours.trim() ? Number(sleepHours) : null,
        sleepQuality: Number(sleepQuality),
        soreness: Number(soreness),
        stress: Number(stress),
        hasPain: painToggle === 'yes',
        painNotes: painToggle === 'yes' ? painNotes.trim() || null : null,
      });
    } catch (err) {
      Alert.alert(
        'Could not save check-in',
        getErrorMessage(err, 'Please try again.'),
      );
    }
  };

  const onRejectAll = () => {
    setDecisions(
      Object.fromEntries(proposedAdaptations.map(change => [change.id, false])),
    );
  };

  const goToLogWorkout = () => {
    navigation.replace('ActiveWorkoutOverview', {
      programDayId: params.programDayId,
      scheduledWorkoutId: params.scheduledWorkoutId,
    });
  };

  const onStartWorkout = async () => {
    if (!userId || proposedAdaptations.length === 0 || hasExistingReview) {
      goToLogWorkout();
      return;
    }
    const acceptedCount = proposedAdaptations.filter(
      change => decisions[change.id],
    ).length;
    const rejectedCount = proposedAdaptations.length - acceptedCount;
    if (acceptedCount > 0)
      trackEvent('adaptation_accepted', { count: acceptedCount });
    if (rejectedCount > 0)
      trackEvent('adaptation_rejected', { count: rejectedCount });

    try {
      await saveAdaptations.mutateAsync({
        userId,
        programDayId: params.programDayId ?? null,
        scheduledWorkoutId: params.scheduledWorkoutId ?? null,
        readinessCheckinId: readinessContext.checkinId,
        decisions: proposedAdaptations.map(change => ({
          change,
          accepted: decisions[change.id] ?? false,
        })),
      });
      goToLogWorkout();
    } catch (err) {
      Alert.alert(
        'Could not start workout',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
        <Header title="Readiness Check-In" />
        <LoadingState />
      </SafeAreaView>
    );
  }

  if (showCheckinForm) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
        <Header title="Readiness Check-In" />
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
            <Text variant="body" color="secondary">
              A quick check-in helps Arnold recommend today's intensity. This is
              informational, not medical advice.
            </Text>
            <TextField
              label="Hours of sleep"
              keyboardType="decimal-pad"
              placeholder="e.g. 7.5"
              value={sleepHours}
              onChangeText={setSleepHours}
            />
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="label" color="secondary">
                SLEEP QUALITY (1-5)
              </Text>
              <SegmentedControl
                options={RATING_OPTIONS}
                value={sleepQuality}
                onChange={setSleepQuality}
              />
            </View>
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="label" color="secondary">
                SORENESS (1-5)
              </Text>
              <SegmentedControl
                options={RATING_OPTIONS}
                value={soreness}
                onChange={setSoreness}
              />
            </View>
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="label" color="secondary">
                STRESS (1-5)
              </Text>
              <SegmentedControl
                options={RATING_OPTIONS}
                value={stress}
                onChange={setStress}
              />
            </View>
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="label" color="secondary">
                PAIN
              </Text>
              <SegmentedControl
                options={PAIN_OPTIONS}
                value={painToggle}
                onChange={setPainToggle}
              />
              {painToggle === 'yes' ? (
                <TextField
                  placeholder="Where does it hurt, and how does it feel?"
                  value={painNotes}
                  onChangeText={setPainNotes}
                  multiline
                />
              ) : null}
            </View>
            <Button
              label="Continue"
              onPress={onSubmitCheckin}
              loading={submitCheckin.isPending}
            />
            <Button
              label="Skip check-in"
              variant="ghost"
              onPress={() => setSkippedCheckin(true)}
            />

            <Animated.View style={keyboardSpacerStyle} />
          </ScrollView>
        </KeyboardAvoider>
      </SafeAreaView>
    );
  }

  if (!readiness) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
        <Header title="Readiness Check-In" />
        <LoadingState />
      </SafeAreaView>
    );
  }

  const visibleAdaptations = hasExistingReview ? [] : proposedAdaptations;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <Header title="Readiness Check-In" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingTop: 0,
          paddingBottom: theme.spacing.lg + tabBarHeight,
          gap: theme.spacing.lg,
        }}
      >
        <Card
          variant="elevated"
          style={{
            alignItems: 'center',
            gap: theme.spacing.sm,
            paddingVertical: theme.spacing.xl,
          }}
        >
          <ProgressRing
            progress={readiness.score / 100}
            centerValue={`${readiness.score}`}
            label={readiness.band.replace('_', ' ')}
          />
          <Text
            variant="body"
            color="secondary"
            style={{ textAlign: 'center' }}
          >
            {readiness.summary}
          </Text>
        </Card>

        <Card variant="flat" style={{ gap: theme.spacing.sm }}>
          <Text variant="subtitle">Today's plan</Text>
          <ListRow
            title="Recommended intensity"
            trailing={
              <Text variant="body">
                {readiness.recommendedIntensity.replace('_', ' ')}
              </Text>
            }
          />
          <ListRow
            title="Target RPE range"
            trailing={
              <Text variant="body">
                {readiness.recommendedRpeRange[0]}-
                {readiness.recommendedRpeRange[1]}
              </Text>
            }
          />
          <ListRow
            title="Estimated session quality"
            trailing={
              <Text variant="body">{readiness.estimatedSessionQuality}</Text>
            }
          />
        </Card>

        <Card variant="flat" style={{ gap: theme.spacing.xs }}>
          <Text variant="subtitle">Main factors</Text>
          {readiness.factors
            .filter(factor => factor.available)
            .slice(0, 4)
            .map(factor => (
              <ListRow
                key={factor.key}
                title={factor.label}
                subtitle={factor.detail}
              />
            ))}
        </Card>

        {painRisk.stopAndSeekMedicalAttention ? (
          <Card
            variant="flat"
            style={{
              gap: theme.spacing.xs,
              borderColor: theme.colors.semantic.danger,
              borderWidth: 1,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.sm,
              }}
            >
              <Icon
                name="circleAlert"
                size="md"
                color={theme.colors.semantic.danger}
              />
              <Text
                variant="subtitle"
                style={{ color: theme.colors.semantic.danger, flex: 1 }}
              >
                Please read before continuing
              </Text>
            </View>
            <Text variant="body" color="secondary">
              {painRisk.recommendation}
            </Text>
          </Card>
        ) : null}

        {hasExistingReview ? (
          <Card variant="flat" style={{ gap: theme.spacing.xs }}>
            <Text variant="subtitle">Already reviewed today</Text>
            <Text variant="body" color="secondary">
              You've already reviewed today's plan for this workout. Starting
              will use the changes you decided on.
            </Text>
          </Card>
        ) : !isPremium ? (
          <LockedFeatureCard
            title="Adaptive Coaching Intelligence"
            description="Pro automatically adjusts sets, weight, and rest based on your readiness — today's plan is unchanged."
            onUpgrade={() =>
              rootNavigation.navigate('Paywall', {
                trigger: 'adaptive_coaching',
              })
            }
          />
        ) : visibleAdaptations.length > 0 ? (
          <Card variant="flat" style={{ gap: theme.spacing.sm }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text variant="subtitle">Suggested changes today</Text>
              <Button
                label="Keep original plan"
                variant="ghost"
                size="sm"
                onPress={onRejectAll}
              />
            </View>
            {visibleAdaptations.map(change => {
              const accepted = decisions[change.id] ?? true;
              const exerciseLabel = change.targetExerciseId
                ? exerciseNameById.get(change.targetExerciseId) ?? 'Exercise'
                : 'Whole workout';
              return (
                <Card
                  key={change.id}
                  variant="subtle"
                  style={{ gap: theme.spacing.xs }}
                >
                  <Text variant="body" style={{ fontWeight: '700' }}>
                    {exerciseLabel}
                  </Text>
                  <Text variant="caption" color="secondary">
                    {String(change.originalValue)} →{' '}
                    {String(change.updatedValue)} ({change.fieldChanged})
                  </Text>
                  <Text variant="caption" color="tertiary">
                    {change.reason}
                  </Text>
                  <SegmentedControl
                    options={[
                      { value: 'accept', label: 'Accept' },
                      { value: 'reject', label: 'Reject' },
                    ]}
                    value={accepted ? 'accept' : 'reject'}
                    onChange={value =>
                      setDecisions(prev => ({
                        ...prev,
                        [change.id]: value === 'accept',
                      }))
                    }
                  />
                </Card>
              );
            })}
          </Card>
        ) : null}

        <Button
          label="Start Workout"
          onPress={onStartWorkout}
          loading={saveAdaptations.isPending}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
