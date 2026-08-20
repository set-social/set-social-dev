import React from 'react';
import { useTheme } from '../../theme/ThemeProvider';
import { Card, Text, Icon } from '../../components/core';

type StreakRiskNudgeProps = {
  streak: number;
  hour: number;
  isTodayCompleted: boolean;
  hasPlanToday: boolean;
};

/** Matches greeting()'s own "Good evening" cutoff (TodayScreen.tsx) so the
 * two never disagree about when the day is "getting late." */
const EVENING_HOUR = 17;

/** Same streak/plan data the week strip's flame pill and the weekly-progress
 * row already read (see computeStreak, todayPlan in TodayScreen.tsx) —
 * reframed as a time-aware nudge instead of a passive count, and only once
 * there's actually something left to protect: a live streak, a required day
 * that's still unlogged, and it's evening. */
export function StreakRiskNudge({ streak, hour, isTodayCompleted, hasPlanToday }: StreakRiskNudgeProps) {
  const theme = useTheme();
  if (streak <= 0 || isTodayCompleted || !hasPlanToday || hour < EVENING_HOUR) return null;

  const hoursLeft = Math.max(1, 24 - hour);

  return (
    <Card variant="elevated" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
      <Icon name="flame" size="sm" color={theme.colors.accent.primary} />
      <Text variant="caption" color="secondary" style={{ flex: 1 }}>
        Your {streak}-day streak is still alive — about {hoursLeft} hour{hoursLeft === 1 ? '' : 's'} left today.
      </Text>
    </Card>
  );
}
