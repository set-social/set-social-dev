import React from 'react';
import { FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import { Header, ListRow, LoadingState, EmptyState, Text } from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useCoachingSummaries, type CoachingSummaryRow } from '../../services/api/queries/coachingHistory';
import type { ProgressStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<ProgressStackParamList>;

// All-time, no pagination — same convention ProgressTimelineScreen already
// uses at this app's data scale (see docs/ai-coaching.md), same posture
// here per docs/coaching-history.md's "Read path" section.
export function CoachingHistoryScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const navigation = useNavigation<Nav>();
  const userId = useAuthStore(state => state.userId);
  const { data: summaries, isLoading, isError, refetch } = useCoachingSummaries(userId);

  const renderItem = ({ item }: { item: CoachingSummaryRow }) => (
    <ListRow
      title={format(new Date(item.createdAt), 'MMM d, yyyy')}
      // Explicit truncated Text node (not a plain string) so every row
      // stays a uniform height regardless of how long a given summary's
      // templated text runs — ListRow's own string-subtitle path has no
      // line cap.
      subtitle={
        <Text variant="caption" color="secondary" numberOfLines={2}>
          {item.summary.summary}
        </Text>
      }
      showChevron
      onPress={() => navigation.navigate('CoachingSummaryDetail', { workoutLogId: item.workoutLogId })}
    />
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <Header title="Coaching History" />
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        // Distinct from the "genuinely no rows yet" empty state below — a
        // failed fetch (network drop, RLS/schema issue) used to render
        // identically to "no coaching summaries yet," which would have
        // silently hidden a real problem behind what looks like expected,
        // by-design emptiness (this feature has no backfill, so a truly
        // empty list is also completely normal for anyone who hasn't
        // finished a workout since it shipped — that ambiguity is exactly
        // why an actual failure needs its own distinguishable state).
        <EmptyState
          icon="circleAlert"
          title="Couldn't load your history"
          description="Check your connection and try again."
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      ) : !summaries || summaries.length === 0 ? (
        <EmptyState
          icon="clock"
          title="No coaching summaries yet"
          description="Finish a workout and Arnold's summary will show up here."
        />
      ) : (
        <FlatList
          data={summaries}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            padding: theme.spacing.lg,
            paddingBottom: theme.spacing.lg + tabBarHeight,
            gap: theme.spacing.sm,
          }}
        />
      )}
    </SafeAreaView>
  );
}
