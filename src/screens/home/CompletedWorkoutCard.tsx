import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { format } from 'date-fns';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Text,
  AiCard,
  Icon,
  StatTile,
  Button,
  LoadingState,
} from '../../components/core';
import {
  useWorkoutLogDetail,
  type WorkoutLogSetDetail,
  type CardioLogSummary,
} from '../../services/api/queries/workoutLogs';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import { formatVolume, formatWeight, unitLabel } from '../../utils/units';
import { formatPace } from '../../utils/routeMetrics';
import type { UnitPreference } from '../../types/database';
import type { RootStackParamList } from '../../navigation/types';

type DaySummary = {
  durationMinutes: number;
  totalSets: number;
  totalReps: number;
  totalVolumeKg: number;
  exerciseCount: number;
};

type CompletedWorkoutCardProps = {
  selectedDate: Date;
  isSelectedToday: boolean;
  workoutLogIds: string[];
  fallbackTitle: string | null;
  isPr: boolean;
  summary: DaySummary | null;
};

const FLIP_DURATION = 350;

/**
 * The completed-day card, front face aggregate summary / back face
 * per-exercise summary — a literal card flip rather than a navigate-away
 * screen, so it works identically whether "today" or a past date is
 * selected (WeekTimeline drives both through the same selectedDate/
 * isSelectedCompleted branch).
 *
 * Both faces are read-only: this card is for reviewing what happened, not
 * editing it. "Edit Workout" on the back face sends the user to
 * WorkoutLogDetailScreen (Training tab), the one place edits/deletes for a
 * logged workout actually happen.
 *
 * Both faces share one rotateY value: front = value, back = value + 180.
 * backfaceVisibility hides whichever face is oriented away from the viewer,
 * and since the two are exactly 180deg apart, that's always precisely one
 * of them — never both, never neither. The face currently facing the viewer
 * ("settled") renders in normal flow, so it's what actually sizes the card;
 * the other only renders as an absolute overlay while a flip is in flight
 * (needed so its content exists in the tree the instant it's tapped, e.g.
 * for accessibility/tests, even though the rotation keeps it invisible
 * until the swap). That settled face is swapped for the incoming one right
 * as the animated value crosses the 90deg point, which is the instant the
 * old face turns invisible — so the card's height changes exactly when
 * nothing is visible to jump, instead of the moment the tap happens.
 */
export function CompletedWorkoutCard({
  selectedDate,
  isSelectedToday,
  workoutLogIds,
  fallbackTitle,
  isPr,
  summary,
}: CompletedWorkoutCardProps) {
  const theme = useTheme();
  const unitPref = useUnitPreference();
  const rootNavigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const [targetIsBack, setTargetIsBack] = useState(false);
  const [settledIsBack, setSettledIsBack] = useState(false);
  const [cardHeight, setCardHeight] = useState<number>();
  const targetIsBackRef = useRef(targetIsBack);
  const prevValueRef = useRef(0);

  // Pinned to the front face's natural height so the back face — whose
  // content length depends on how many exercises/sets were logged — scrolls
  // internally instead of growing the card past where the front face sat.
  const onFrontLayout = (e: LayoutChangeEvent) =>
    setCardHeight(e.nativeEvent.layout.height);

  useEffect(() => {
    const id = rotateAnim.addListener(({ value }) => {
      const prev = prevValueRef.current;
      if ((prev < 90 && value >= 90) || (prev > 90 && value <= 90)) {
        setSettledIsBack(targetIsBackRef.current);
      }
      prevValueRef.current = value;
    });
    return () => rotateAnim.removeListener(id);
  }, [rotateAnim]);

  const toggleFlip = () => {
    const next = !targetIsBack;
    targetIsBackRef.current = next;
    setTargetIsBack(next);
    Animated.timing(rotateAnim, {
      toValue: next ? 180 : 0,
      duration: FLIP_DURATION,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(() => setSettledIsBack(targetIsBackRef.current));
  };

  const onEditWorkout = () => {
    // CompletedWorkoutCard lives on TodayStack; WorkoutLogDetail lives on
    // ProgramsStack (the Training tab) — go via the root navigator, same
    // cross-stack pattern DayDetailScreen uses for its own Training-tab hops.
    rootNavigation.navigate('MainTabs', {
      screen: 'ProgramsTab',
      params: {
        screen: 'WorkoutLogDetail',
        params: {
          workoutLogIds,
          title: fallbackTitle,
          dateLabel: format(selectedDate, 'EEEE, MMM d'),
        },
      },
    });
  };

  const frontRotateY = rotateAnim.interpolate({
    inputRange: [0, 180],
    outputRange: ['0deg', '180deg'],
  });
  const backRotateY = rotateAnim.interpolate({
    inputRange: [0, 180],
    outputRange: ['180deg', '360deg'],
  });

  const renderFace = (isBack: boolean, overlay: boolean) => (
    <Animated.View
      style={[
        {
          transform: [
            { perspective: 1000 },
            { rotateY: isBack ? backRotateY : frontRotateY },
          ],
          backfaceVisibility: 'hidden',
        },
        overlay ? { position: 'absolute', top: 0, left: 0, right: 0 } : null,
      ]}
      onLayout={isBack ? undefined : onFrontLayout}
    >
      {isBack ? (
        <AiCard style={{ height: cardHeight, gap: theme.spacing.md }}>
          {/* Only the header is the flip-back tap target — wrapping the whole
              card (including the ScrollView below) in one Pressable eats the
              vertical pan gesture before the ScrollView's native scroll can
              claim it, which is what made the back face unscrollable. Made as
              big and obvious as that constraint allows: a full-width row with
              generous vertical padding (not just the text's own line height)
              plus a visible "flip back" icon, since a bare text label was too
              easy to miss/mis-tap in the gym.
          */}
          <Pressable
            onPress={toggleFlip}
            accessibilityRole="button"
            accessibilityLabel="Flip back to summary"
            hitSlop={8}
            style={({ pressed }) => [
              {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginHorizontal: -theme.spacing.md,
                marginTop: -theme.spacing.md,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.md,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <Text variant="subtitle">Workout Summary</Text>
            <Icon
              name="rotateCcw"
              size="sm"
              color={theme.colors.text.secondary}
            />
          </Pressable>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: theme.spacing.md }}
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled
          >
            {workoutLogIds.map(id => (
              <WorkoutLogSummarySection
                key={id}
                workoutLogId={id}
                unitPref={unitPref}
              />
            ))}
          </ScrollView>
          <Button
            label="Edit Workout"
            variant="secondary"
            onPress={onEditWorkout}
          />
        </AiCard>
      ) : (
        <Pressable
          onPress={toggleFlip}
          accessibilityRole="button"
          accessibilityLabel="Flip to see full workout"
        >
          <AiCard style={{ gap: theme.spacing.md }}>
            <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
              <Icon
                name="circleCheck"
                size="lg"
                color={theme.colors.accent.primary}
              />
              <Text variant="subtitle">
                {isSelectedToday
                  ? "Today's workout is done"
                  : `${format(selectedDate, 'EEEE')}'s workout is done`}
              </Text>
              <Text
                variant="body"
                color="secondary"
                style={{ textAlign: 'center' }}
              >
                {fallbackTitle ?? 'Nice work.'}
              </Text>
              {isPr ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.xxs,
                    backgroundColor: theme.colors.accent.subtle,
                    borderRadius: theme.radii.pill,
                    paddingHorizontal: theme.spacing.sm,
                    paddingVertical: theme.spacing.xxs,
                  }}
                >
                  <Icon
                    name="trophy"
                    size="sm"
                    color={theme.colors.accent.primary}
                  />
                  <Text
                    variant="caption"
                    style={{
                      color: theme.colors.accent.primary,
                      fontWeight: '700',
                    }}
                  >
                    New PR
                  </Text>
                </View>
              ) : null}
            </View>

            {summary ? (
              <View style={{ gap: theme.spacing.sm }}>
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <StatTile
                      label="Duration"
                      value={`${summary.durationMinutes} min`}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <StatTile label="Exercises" value={summary.exerciseCount} />
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <StatTile label="Sets" value={summary.totalSets} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <StatTile
                      label="Volume"
                      value={`${formatVolume(
                        summary.totalVolumeKg,
                        unitPref,
                      )} ${unitLabel(unitPref)}`}
                    />
                  </View>
                </View>
              </View>
            ) : null}

            <Text
              variant="caption"
              color="tertiary"
              style={{ textAlign: 'center' }}
            >
              Tap to see the full workout
            </Text>
          </AiCard>
        </Pressable>
      )}
    </Animated.View>
  );

  // Each face keeps one fixed isBack value for its entire mounted lifetime —
  // front is always driven by frontRotateY, back always by backRotateY, so
  // rotateY never gets reassigned to a different interpolation mid-flight.
  // (An earlier version picked isBack from settledIsBack for the "settled"
  // slot, so the same Animated.View would jump from being driven by
  // frontRotateY to backRotateY — two different nodes evaluating the same
  // rotateAnim value — right at the crossing point, snapping the transform
  // from ~90deg to ~270deg in one frame. That was the mid-flip flicker.)
  // Only `overlay` (absolute vs normal flow) and mount/unmount change here.
  const showFront = !settledIsBack || !targetIsBack;
  const showBack = settledIsBack || targetIsBack;

  return (
    <View style={{ position: 'relative' }}>
      {showFront ? renderFace(false, settledIsBack) : null}
      {showBack ? renderFace(true, !settledIsBack) : null}
    </View>
  );
}

/** Read-only per-exercise/per-set breakdown for one workout_log — most days
 * this is the only section, but more than one workout completed the same
 * day each gets its own. No inputs, no delete affordances: this card is for
 * reviewing, not editing (see "Edit Workout" above for that). */
function WorkoutLogSummarySection({
  workoutLogId,
  unitPref,
}: {
  workoutLogId: string;
  unitPref: UnitPreference;
}) {
  const theme = useTheme();
  const { data: detail, isLoading } = useWorkoutLogDetail(workoutLogId);

  if (isLoading || !detail) {
    return <LoadingState fill={false} />;
  }

  const exerciseOrder: string[] = [];
  const setsByExercise = new Map<string, WorkoutLogSetDetail[]>();
  for (const setRow of detail.sets) {
    if (!setsByExercise.has(setRow.exerciseId)) {
      exerciseOrder.push(setRow.exerciseId);
      setsByExercise.set(setRow.exerciseId, []);
    }
    setsByExercise.get(setRow.exerciseId)!.push(setRow);
  }

  return (
    <View style={{ gap: theme.spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
        {detail.cardio ? (
          <Icon name="flame" size="sm" color={theme.colors.accent.orange} />
        ) : null}
        <Text variant="body" style={{ fontWeight: '700' }}>
          {detail.title}
        </Text>
      </View>
      {detail.cardio ? (
        <Text variant="caption" color="tertiary">
          {describeCardio(detail.cardio)}
        </Text>
      ) : (
        exerciseOrder.map(exerciseId => {
          const sets = setsByExercise.get(exerciseId)!;
          return (
            <View key={exerciseId} style={{ gap: theme.spacing.xs }}>
              <Text variant="body" color="secondary">
                {sets[0].exerciseName}
              </Text>
              {sets.map(setRow => (
                <Text key={setRow.id} variant="caption" color="tertiary">
                  {describeSet(setRow, unitPref)}
                </Text>
              ))}
            </View>
          );
        })
      )}
    </View>
  );
}

function describeSet(
  setRow: WorkoutLogSetDetail,
  unitPref: UnitPreference,
): string {
  const parts = [`Set ${setRow.setNumber}: ${setRow.reps} reps`];
  if (setRow.durationSeconds != null) parts.push(`${setRow.durationSeconds}s`);
  else if (setRow.loadKg != null)
    parts.push(
      `${formatWeight(setRow.loadKg, unitPref)} ${unitLabel(unitPref)}`,
    );
  if (setRow.rpe != null) parts.push(`RPE ${setRow.rpe}`);
  return parts.join(' · ');
}

function describeCardio(cardio: CardioLogSummary): string {
  const parts = [`${cardio.durationMinutes} min`];
  if (cardio.distanceKm != null) parts.push(`${cardio.distanceKm.toFixed(2)} km`);
  if (cardio.avgPaceSecPerKm != null) parts.push(`${formatPace(cardio.avgPaceSecPerKm)}/km`);
  parts.push(`${cardio.estimatedCalories} cal`);
  return parts.join(' · ');
}
