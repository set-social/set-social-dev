import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Card, ListRow, ProBadge } from '../../components/core';
import { formatVolume, unitLabel } from '../../utils/units';
import type { LeaderboardEntry } from '../../services/api/queries/community';
import type { UnitPreference } from '../../types/database';

type LeaderboardRowProps = {
  entry: LeaderboardEntry;
  rank: number;
  isLive: boolean;
  unitPref: UnitPreference;
  // Takes the entry rather than being pre-bound per row, so the parent can
  // pass one stable function reference for the whole list (via useCallback)
  // instead of a fresh closure per row per render.
  onPress: (entry: LeaderboardEntry) => void;
};

/** One row in the friends leaderboard. Memoized — this renders inside
 * LeaderboardScreen's FlatList; without this every row re-renders whenever
 * the screen re-renders (e.g. a live-workout status change), not just the
 * one(s) that actually changed. */
export const LeaderboardRow = React.memo(function LeaderboardRow({
  entry,
  rank,
  isLive,
  unitPref,
  onPress,
}: LeaderboardRowProps) {
  const theme = useTheme();

  return (
    <Card
      variant={entry.isSelf ? 'flat' : 'subtle'}
      style={{
        padding: theme.spacing.sm,
        borderColor: entry.isSelf
          ? theme.colors.accent.primary
          : theme.colors.border.subtle,
      }}
    >
      <ListRow
        title={
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.xs,
            }}
          >
            <Text variant="body">
              {entry.isSelf ? 'You' : entry.display_name ?? 'Athlete'}
            </Text>
            {isLive ? (
              <View
                accessibilityLabel="Live now"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: theme.colors.accent.primary,
                }}
              />
            ) : null}
            {entry.is_premium ? <ProBadge /> : null}
          </View>
        }
        subtitle={`${entry.workoutsThisMonth} workout${
          entry.workoutsThisMonth === 1 ? '' : 's'
        } this month`}
        leading={
          <Text variant="subtitle" color="secondary" style={{ width: 24 }}>
            {rank}
          </Text>
        }
        trailing={
          <Text variant="body">
            {formatVolume(entry.volumeThisMonth, unitPref)} {unitLabel(unitPref)}
          </Text>
        }
        onPress={entry.isSelf ? undefined : () => onPress(entry)}
        style={{ paddingVertical: 0 }}
      />
    </Card>
  );
});
