import React, { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import {
  Text,
  Card,
  Button,
  Header,
  IconButton,
  LoadingState,
} from '../../components/core';
import {
  useScheduledWorkout,
  useDeleteScheduledWorkout,
} from '../../services/api/queries/scheduledWorkouts';
import { buildWorkoutSnapshot } from '../../services/api/queries/workoutShares';
import {
  navigateToStartWorkout,
  navigateToChooseVariant,
} from '../../navigation/startWorkoutFlow';
import { featureFlags } from '../../config/featureFlags';
import type {
  RootStackParamList,
  ProgramsStackParamList,
} from '../../navigation/types';

type Route = RouteProp<ProgramsStackParamList, 'ScheduledWorkoutDetail'>;
type RootNav = NativeStackNavigationProp<RootStackParamList>;

export function ScheduledWorkoutDetailScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const rootNavigation = useNavigation<RootNav>();
  const { params } = useRoute<Route>();
  const { data: scheduled, isLoading } = useScheduledWorkout(
    params.scheduledWorkoutId,
  );
  const deleteScheduledWorkout = useDeleteScheduledWorkout();
  const [sharing, setSharing] = useState(false);

  const isFutureDay =
    scheduled != null &&
    scheduled.scheduled_date > format(new Date(), 'yyyy-MM-dd');

  const onShare = async () => {
    if (!scheduled || sharing) return;
    setSharing(true);
    try {
      const payload = {
        workout: await buildWorkoutSnapshot(
          {
            name: scheduled.name,
            notes: scheduled.notes,
            estimatedDurationMinutes: null,
          },
          scheduled.scheduled_workout_exercises,
        ),
      };
      rootNavigation.navigate('MainTabs', {
        screen: 'ProgramsTab',
        params: {
          screen: 'ShareWorkout',
          params: {
            shareType: 'single_workout',
            title: scheduled.name,
            payload,
          },
        },
      });
    } catch (err) {
      Alert.alert(
        'Could not prepare this workout to share',
        err instanceof Error ? err.message : 'Please try again.',
      );
    } finally {
      setSharing(false);
    }
  };

  const onDelete = () => {
    if (!scheduled) return;
    Alert.alert('Delete this workout?', "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteScheduledWorkout.mutateAsync(scheduled.id);
            rootNavigation.goBack();
          } catch (err) {
            Alert.alert(
              'Could not delete workout',
              err instanceof Error ? err.message : 'Please try again.',
            );
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <Header
        title={scheduled?.name ?? 'Workout'}
        right={
          scheduled ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.xs,
              }}
            >
              <IconButton
                name="share"
                variant="ghost"
                accessibilityLabel="Share this workout"
                onPress={onShare}
                disabled={sharing}
              />
              <IconButton
                name="trash"
                variant="ghost"
                accessibilityLabel="Delete workout"
                onPress={onDelete}
              />
            </View>
          ) : undefined
        }
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingTop: 0,
          paddingBottom: theme.spacing.lg + tabBarHeight,
          gap: theme.spacing.md,
        }}
      >
        {isLoading || !scheduled ? (
          <LoadingState fill={false} />
        ) : (
          <>
            <Text variant="body" color="secondary">
              {format(new Date(scheduled.scheduled_date), 'EEEE, MMM d, yyyy')}
            </Text>

            {scheduled.scheduled_workout_exercises.map(se => (
              <Card
                key={se.id}
                variant="elevated"
                style={{ gap: theme.spacing.xs }}
              >
                <Text variant="subtitle">{se.exercises.name}</Text>
                <Text variant="body" color="secondary">
                  {se.target_sets} sets × {se.target_reps_min}
                  {se.target_reps_max &&
                  se.target_reps_max !== se.target_reps_min
                    ? `-${se.target_reps_max}`
                    : ''}{' '}
                  reps
                  {se.target_rpe ? ` @ RPE ${se.target_rpe}` : ''}
                </Text>
                {se.rest_seconds ? (
                  <Text variant="caption" color="tertiary">
                    Rest {se.rest_seconds}s
                  </Text>
                ) : null}
              </Card>
            ))}

            <Button
              label="Start Workout"
              disabled={isFutureDay}
              onPress={() =>
                navigateToStartWorkout(rootNavigation, {
                  scheduledWorkoutId: scheduled.id,
                })
              }
            />
            {isFutureDay ? (
              <Text
                variant="caption"
                color="secondary"
                style={{ textAlign: 'center' }}
              >
                Check back tomorrow!
              </Text>
            ) : null}
            {featureFlags.aiCoaching ? (
              <Button
                label="Choose a workout variant"
                variant="secondary"
                onPress={() =>
                  navigateToChooseVariant(rootNavigation, {
                    scheduledWorkoutId: scheduled.id,
                  })
                }
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
