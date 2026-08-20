import React, { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import {
  Text,
  Header,
  ListRow,
  IconButton,
  LoadingState,
  EmptyState,
  LockedFeatureCard,
  type IconName,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useProfile } from '../../services/api/queries/profiles';
import {
  useLoggedSets,
  computePrEvents,
} from '../../services/api/queries/progress';
import { useBodyMetrics } from '../../services/api/queries/bodyMetrics';
import {
  useAllWorkoutLogs,
  useDeleteWorkoutLog,
} from '../../services/api/queries/workoutLogs';
import {
  buildProgressTimeline,
  type TimelineEntry,
} from '../../utils/progressTimeline';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import { formatWeight, unitLabel } from '../../utils/units';
import type {
  ProgressStackParamList,
  RootStackParamList,
} from '../../navigation/types';

type Nav = NativeStackNavigationProp<ProgressStackParamList>;
type RootNav = NativeStackNavigationProp<RootStackParamList>;

type ListItem =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'entry'; key: string; entry: TimelineEntry };

function buildListItems(entries: TimelineEntry[]): ListItem[] {
  const items: ListItem[] = [];
  let lastMonth: string | null = null;
  entries.forEach((entry, index) => {
    const month = format(new Date(entry.date), 'MMMM yyyy');
    if (month !== lastMonth) {
      items.push({ kind: 'header', key: `header-${month}`, label: month });
      lastMonth = month;
    }
    items.push({
      kind: 'entry',
      key: `${entry.type}-${entry.date}-${index}`,
      entry,
    });
  });
  return items;
}

function describeEntry(
  entry: TimelineEntry,
  unitPref: ReturnType<typeof useUnitPreference>,
): { icon: IconName; title: string; trailing?: string } {
  switch (entry.type) {
    case 'pr':
      return {
        icon: 'trophy',
        title: entry.exerciseName,
        trailing: `${formatWeight(entry.loadKg, unitPref)}${unitLabel(
          unitPref,
        )} × ${entry.reps}`,
      };
    case 'body_metric':
      return {
        icon: 'scale',
        title: 'Body weight logged',
        trailing: `${formatWeight(entry.weightKg, unitPref)}${unitLabel(
          unitPref,
        )}`,
      };
    case 'workout_completed':
      return {
        icon: 'dumbbell',
        title: entry.title,
        trailing: entry.rating != null ? `${entry.rating}/5` : undefined,
      };
    case 'milestone':
      return {
        icon: 'medal',
        title: `Milestone: ${entry.count} workouts completed`,
      };
  }
}

export function ProgressTimelineScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const navigation = useNavigation<Nav>();
  const rootNavigation = useNavigation<RootNav>();
  const userId = useAuthStore(state => state.userId);
  const { data: profile } = useProfile(userId);
  const unitPref = useUnitPreference();

  const {
    data: loggedSets,
    isLoading: setsLoading,
    refetch: refetchSets,
  } = useLoggedSets(userId);
  const {
    data: bodyMetrics,
    isLoading: metricsLoading,
    refetch: refetchMetrics,
  } = useBodyMetrics(userId);
  const {
    data: workoutLogs,
    isLoading: logsLoading,
    refetch: refetchLogs,
  } = useAllWorkoutLogs(userId);
  const isLoading = setsLoading || metricsLoading || logsLoading;
  const deleteWorkoutLog = useDeleteWorkoutLog();

  const onDeleteWorkout = (workoutLogId: string) => {
    Alert.alert('Delete this workout?', "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteWorkoutLog.mutate(workoutLogId),
      },
    ]);
  };

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetchSets(), refetchMetrics(), refetchLogs()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchSets, refetchMetrics, refetchLogs]);

  const entries = useMemo(() => {
    if (!loggedSets || !bodyMetrics || !workoutLogs) return [];
    return buildProgressTimeline(
      computePrEvents(loggedSets),
      bodyMetrics,
      workoutLogs,
    );
  }, [loggedSets, bodyMetrics, workoutLogs]);

  const listItems = useMemo(() => buildListItems(entries), [entries]);

  // Safety net behind the dashboard's own gate on the entry point — this
  // screen must never show the full timeline to a non-Pro account
  // regardless of how it was reached.
  if (!profile?.is_premium) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: theme.colors.bg.base }}
        edges={['top']}
      >
        <Header title="Progress Timeline" />
        <View style={{ padding: theme.spacing.lg }}>
          <LockedFeatureCard
            title="Progress Timeline"
            description="Your full training and PR history in one place — part of SetSocial Pro."
            onUpgrade={() =>
              rootNavigation.navigate('Paywall', { trigger: 'analytics' })
            }
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg.base }}
      edges={['top']}
    >
      <Header title="Progress Timeline" />
      {isLoading ? (
        <LoadingState />
      ) : (
        <FlatList
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          data={listItems}
          keyExtractor={item => item.key}
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.lg + tabBarHeight,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.accent.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="activity"
              title="Nothing to show yet"
              description="PRs, body-weight logs, and completed workouts will show up here over time."
            />
          }
          renderItem={({ item }) => {
            if (item.kind === 'header') {
              return (
                <Text
                  variant="label"
                  color="secondary"
                  style={{
                    paddingTop: theme.spacing.md,
                    paddingBottom: theme.spacing.xs,
                  }}
                >
                  {item.label.toUpperCase()}
                </Text>
              );
            }
            const entry = item.entry;
            const { icon, title, trailing } = describeEntry(entry, unitPref);
            return (
              <View
                style={{
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.border.subtle,
                }}
              >
                <ListRow
                  icon={icon}
                  title={title}
                  subtitle={format(new Date(entry.date), 'MMM d')}
                  trailing={
                    entry.type === 'workout_completed' ? (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: theme.spacing.xs,
                        }}
                      >
                        {trailing ? (
                          <Text variant="body" color="secondary">
                            {trailing}
                          </Text>
                        ) : null}
                        <IconButton
                          name="trash"
                          variant="ghost"
                          size={20}
                          accessibilityLabel="Delete workout"
                          onPress={() => onDeleteWorkout(entry.id)}
                        />
                      </View>
                    ) : trailing ? (
                      <Text variant="body" color="secondary">
                        {trailing}
                      </Text>
                    ) : undefined
                  }
                  showChevron={entry.type === 'pr'}
                  onPress={
                    entry.type === 'pr'
                      ? () =>
                          navigation.navigate('PRDetail', {
                            exerciseId: entry.exerciseId,
                          })
                      : undefined
                  }
                />
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}
