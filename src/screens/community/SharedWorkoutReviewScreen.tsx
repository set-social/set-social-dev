import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import {
  Text,
  Card,
  Button,
  Header,
  Icon,
  LoadingState,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import {
  useWorkoutShare,
  useAcceptWorkoutShare,
  useDeclineWorkoutShare,
  type SingleWorkoutPayload,
  type WeeklyPlanPayload,
  type WorkoutSnapshot,
  type WorkoutSnapshotExercise,
} from '../../services/api/queries/workoutShares';
import type { CommunityStackParamList } from '../../navigation/types';

type Route = RouteProp<CommunityStackParamList, 'SharedWorkoutReview'>;

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function ExerciseCard({ exercise }: { exercise: WorkoutSnapshotExercise }) {
  const theme = useTheme();
  return (
    <Card variant="elevated" style={{ gap: theme.spacing.xs }}>
      <Text variant="subtitle">{exercise.exerciseName}</Text>
      <Text variant="body" color="secondary">
        {exercise.targetSets} sets × {exercise.targetRepsMin}
        {exercise.targetRepsMax &&
        exercise.targetRepsMax !== exercise.targetRepsMin
          ? `-${exercise.targetRepsMax}`
          : ''}{' '}
        reps
        {exercise.targetRpe ? ` @ RPE ${exercise.targetRpe}` : ''}
      </Text>
      {exercise.restSeconds ? (
        <Text variant="caption" color="tertiary">
          Rest {exercise.restSeconds}s
        </Text>
      ) : null}
    </Card>
  );
}

function WorkoutBreakdown({ workout }: { workout: WorkoutSnapshot }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      {workout.notes ? (
        <Text variant="body" color="secondary">
          {workout.notes}
        </Text>
      ) : null}
      {workout.exercises.map(exercise => (
        <ExerciseCard
          key={`${exercise.orderIndex}-${exercise.exerciseId}`}
          exercise={exercise}
        />
      ))}
    </View>
  );
}

/**
 * Recipient's review of a shared workout or weekly plan — reached by
 * tapping the share card in ConversationScreen. Read-only breakdown
 * (mirrors TrainingDayDetailScreen's own exercise-card rendering) plus,
 * for a single workout, a day-of-week picker before "Add to My Plan" (the
 * chosen day gets overwritten — same upsert-on-conflict behavior
 * AssignTrainingDayScreen already uses). A weekly plan has no day picker:
 * per spec, accepting applies all 7 days at once.
 */
export function SharedWorkoutReviewScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const { params } = useRoute<Route>();
  const userId = useAuthStore(state => state.userId);
  const { data: share, isLoading } = useWorkoutShare(params.shareId);
  const acceptShare = useAcceptWorkoutShare();
  const declineShare = useDeclineWorkoutShare();
  const [dayOfWeek, setDayOfWeek] = useState<number | null>(null);

  const isRecipient = share != null && userId === share.recipient_id;
  const isPending = share?.status === 'pending';

  const onAccept = async () => {
    if (!share || !userId) return;
    if (share.share_type === 'single_workout' && dayOfWeek == null) return;
    try {
      const result = await acceptShare.mutateAsync({
        share,
        recipientId: userId,
        dayOfWeek: dayOfWeek ?? undefined,
      });
      Alert.alert(
        'Added to your plan',
        result.droppedCount > 0
          ? `${result.droppedCount} exercise${
              result.droppedCount === 1 ? '' : 's'
            } couldn't be included — ${
              result.droppedCount === 1 ? 'it was' : 'they were'
            } custom to the sender.`
          : undefined,
      );
    } catch (err) {
      Alert.alert(
        'Could not add to your plan',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  };

  const onDecline = () => {
    if (!share) return;
    Alert.alert('Not add this to your plan?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Not now',
        onPress: () =>
          declineShare.mutate(
            { shareId: share.id },
            {
              onError: err =>
                Alert.alert(
                  'Could not update',
                  err instanceof Error ? err.message : 'Please try again.',
                ),
            },
          ),
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <Header title={share?.title ?? 'Shared Workout'} />
      {isLoading || !share ? (
        <LoadingState fill={false} />
      ) : (
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
          {!isRecipient ? (
            <Card variant="subtle">
              <Text variant="body" color="secondary">
                Waiting for them to review this.
              </Text>
            </Card>
          ) : !isPending ? (
            <Card
              variant="subtle"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.sm,
              }}
            >
              <Icon
                name={share.status === 'accepted' ? 'circleCheck' : 'x'}
                size="sm"
                color={
                  share.status === 'accepted'
                    ? theme.colors.accent.primary
                    : theme.colors.text.tertiary
                }
              />
              <Text
                variant="body"
                style={{
                  color:
                    share.status === 'accepted'
                      ? theme.colors.accent.primary
                      : theme.colors.text.secondary,
                }}
              >
                {share.status === 'accepted'
                  ? 'Added to your plan'
                  : 'Declined'}
              </Text>
            </Card>
          ) : null}

          {share.share_type === 'single_workout' ? (
            <WorkoutBreakdown
              workout={(share.payload as SingleWorkoutPayload).workout}
            />
          ) : (
            <View style={{ gap: theme.spacing.lg }}>
              {(share.payload as WeeklyPlanPayload).days.map(day => (
                <View key={day.dayOfWeek} style={{ gap: theme.spacing.sm }}>
                  <Text variant="label" color="secondary">
                    {WEEKDAY_NAMES[day.dayOfWeek].toUpperCase()}
                  </Text>
                  {day.workout ? (
                    <WorkoutBreakdown workout={day.workout} />
                  ) : (
                    <Card variant="subtle">
                      <Text variant="body" color="secondary">
                        {day.dayType === 'cardio' ? 'Cardio Day' : 'Rest'}
                      </Text>
                    </Card>
                  )}
                </View>
              ))}
            </View>
          )}

          {isRecipient && isPending ? (
            <View style={{ gap: theme.spacing.md }}>
              {share.share_type === 'single_workout' ? (
                <View style={{ gap: theme.spacing.sm }}>
                  <Text variant="label" color="secondary">
                    ASSIGN TO DAY
                  </Text>
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                    }}
                  >
                    {WEEKDAY_LABELS.map((label, index) => {
                      const selected = dayOfWeek === index;
                      return (
                        <Pressable
                          key={index}
                          onPress={() => setDayOfWeek(index)}
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: theme.radii.pill,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: selected
                              ? theme.colors.accent.primary
                              : theme.colors.bg.surface,
                            borderWidth: 1,
                            borderColor: selected
                              ? theme.colors.accent.primary
                              : theme.colors.border.subtle,
                          }}
                        >
                          <Text
                            variant="body"
                            color={selected ? 'onAccent' : 'primary'}
                            style={{ fontWeight: '700' }}
                          >
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text variant="caption" color="tertiary">
                    This overwrites whatever's already assigned to that day.
                  </Text>
                </View>
              ) : (
                <Text variant="caption" color="tertiary">
                  Adding this applies all 7 days, overwriting whatever's already
                  assigned to each.
                </Text>
              )}

              <Button
                label="Add to My Plan"
                onPress={onAccept}
                loading={acceptShare.isPending}
                disabled={
                  share.share_type === 'single_workout' && dayOfWeek == null
                }
              />
              <Button
                label="Not now"
                variant="ghost"
                onPress={onDecline}
                loading={declineShare.isPending}
              />
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
