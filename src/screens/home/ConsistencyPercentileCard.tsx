import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Card, Text, Icon } from '../../components/core';
import { useFriendConsistencyPercentile } from '../../services/api/queries/community';

/** Privacy-safe friend comparison — a single percentile, never a name or a
 * ranked list, so unlike Live Now/gym proximity/Friends Activity this isn't
 * identity-revealing social content. It stays visible even when Focus Mode
 * is on (see TodayScreen.tsx), and is free for everyone — it's strictly
 * less revealing than the existing (already free) Leaderboard. Home's
 * compact vitals summary (StatsRail) reads useFriendConsistencyPercentile
 * directly rather than rendering this card, since it needs just the number. */
export function ConsistencyPercentileCard({ userId }: { userId: string | null }) {
  const theme = useTheme();
  const { data: percentile } = useFriendConsistencyPercentile(userId);
  if (percentile == null) return null;

  return (
    <Card variant="elevated" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: theme.radii.pill,
          backgroundColor: `${theme.colors.accent.teal}24`,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="flame" size="sm" color={theme.colors.accent.teal} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="subtitle">More consistent than {percentile}% of your friends</Text>
        <Text variant="caption" color="secondary">
          Based on workouts logged this month
        </Text>
      </View>
    </Card>
  );
}
