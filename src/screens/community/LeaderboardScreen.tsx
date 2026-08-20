import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, View, type ListRenderItemInfo } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import { Header, EmptyState, LoadingState } from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useLeaderboard, type LeaderboardEntry } from '../../services/api/queries/community';
import { useLiveFriendWorkouts } from '../../services/api/queries/liveWorkouts';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import { LeaderboardRow } from './LeaderboardRow';
import type { CommunityStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<CommunityStackParamList>;

export function LeaderboardScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const navigation = useNavigation<Nav>();
  const userId = useAuthStore(state => state.userId);
  const unitPref = useUnitPreference();

  const { data: leaderboard, isLoading, refetch } = useLeaderboard(userId);
  const { data: liveWorkouts } = useLiveFriendWorkouts(userId);
  const liveFriendIds = useMemo(
    () => new Set((liveWorkouts ?? []).map(w => w.friend.id)),
    [liveWorkouts],
  );

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const onPressEntry = useCallback(
    (entry: LeaderboardEntry) =>
      navigation.navigate('FriendProfile', { userId: entry.id }),
    [navigation],
  );

  const renderItem = useCallback(
    ({ item: entry, index }: ListRenderItemInfo<LeaderboardEntry>) => (
      <LeaderboardRow
        entry={entry}
        rank={index + 1}
        isLive={liveFriendIds.has(entry.id)}
        unitPref={unitPref}
        onPress={onPressEntry}
      />
    ),
    [liveFriendIds, unitPref, onPressEntry],
  );

  // A leaderboard with only yourself in it (no friends added yet) is the
  // same "no friends" empty state as a literal empty list — feeding FlatList
  // an empty array for that case lets ListEmptyComponent handle both without
  // a separate branch.
  const data = leaderboard?.length === 1 ? [] : leaderboard ?? [];

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg.base }}
      edges={['top']}
    >
      <Header title="Leaderboard" />
      <FlatList
        data={data}
        keyExtractor={entry => entry.id}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: theme.spacing.xs }} />}
        ListEmptyComponent={
          isLoading ? (
            <LoadingState fill={false} />
          ) : (
            <EmptyState
              icon="users"
              title="No friends yet"
              description="Search for athletes from the Community tab to add friends and see how you stack up."
            />
          )
        }
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingTop: 0,
          paddingBottom: theme.spacing.lg + tabBarHeight,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent.primary}
          />
        }
      />
    </SafeAreaView>
  );
}
