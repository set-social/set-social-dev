import React from 'react';
import { View } from 'react-native';
import { format } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, AiCard, Icon, StatTile } from '../../components/core';
import type { CardioLogSummary } from '../../services/api/queries/workoutLogs';

type CompletedCardioCardProps = {
  selectedDate: Date;
  isSelectedToday: boolean;
  summary: CardioLogSummary;
};

const EFFORT_LABEL: Record<NonNullable<CardioLogSummary['effort']>, string> = {
  easy: 'Easy',
  moderate: 'Moderate',
  hard: 'Hard',
};

/**
 * Cardio's equivalent of CompletedWorkoutCard — front face only, no flip.
 * A cardio session has no per-exercise/per-set breakdown to put on a back
 * face, just the totals already shown here, so the tap-to-flip interaction
 * CompletedWorkoutCard has doesn't apply.
 */
export function CompletedCardioCard({ selectedDate, isSelectedToday, summary }: CompletedCardioCardProps) {
  const theme = useTheme();

  return (
    <AiCard style={{ gap: theme.spacing.md }}>
      <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        <Icon name="flame" size="lg" color={theme.colors.accent.orange} />
        <Text variant="subtitle">
          {isSelectedToday ? "Today's cardio is done" : `${format(selectedDate, 'EEEE')}'s cardio is done`}
        </Text>
        <Text variant="body" color="secondary" style={{ textAlign: 'center' }}>
          {summary.activityName}
        </Text>
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <View style={{ flex: 1 }}>
            <StatTile label="Duration" value={`${summary.durationMinutes} min`} />
          </View>
          <View style={{ flex: 1 }}>
            <StatTile label="Est. Calories" value={`~${summary.estimatedCalories}`} />
          </View>
        </View>
        {summary.distanceKm != null || summary.effort != null ? (
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            {summary.distanceKm != null ? (
              <View style={{ flex: 1 }}>
                <StatTile label="Distance" value={`${summary.distanceKm.toFixed(1)} km`} />
              </View>
            ) : null}
            {summary.effort != null ? (
              <View style={{ flex: 1 }}>
                <StatTile label="Effort" value={EFFORT_LABEL[summary.effort]} />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </AiCard>
  );
}
