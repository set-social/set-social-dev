import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Card, Icon, ListRow } from '../../components/core';
import type { PostWorkoutSummaryResult } from '../../services/coaching';
import type { UnitPreference } from '../../types/database';
import { formatVolume, formatWeight, unitLabel } from '../../utils/units';

const RECOVERY_LABEL: Record<PostWorkoutSummaryResult['estimatedRecoveryNeeds'], string> = {
  normal: 'Normal — back on schedule.',
  light_next_session: 'Light — you could push a bit harder next time.',
  extra_rest: 'Higher than usual — consider extra rest before your next session.',
};

/**
 * The card stack a PostWorkoutSummaryResult renders as — extracted from
 * WorkoutSummaryScreen (its original, still-only-live-computing caller) so
 * CoachingSummaryDetailScreen can render the exact same presentation
 * against a persisted result instead of duplicating this JSX. Purely
 * presentational: takes an already-computed result, no data fetching, no
 * knowledge of whether it's live or a replay.
 */
export function CoachingSummaryCards({
  summary,
  unitPref,
}: {
  summary: PostWorkoutSummaryResult;
  unitPref: UnitPreference;
}) {
  const theme = useTheme();
  return (
    <>
      <Card variant="elevated" style={{ gap: theme.spacing.xs }}>
        <Text variant="label" color="secondary">
          COACHING SUMMARY
        </Text>
        <Text variant="body">{summary.summary}</Text>
      </Card>

      {summary.painOrFatigueConcern ? (
        <Card
          variant="flat"
          style={{
            gap: theme.spacing.xs,
            borderColor: theme.colors.semantic.danger,
            borderWidth: 1,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Icon name="circleAlert" size="md" color={theme.colors.semantic.danger} />
            <Text variant="subtitle" style={{ color: theme.colors.semantic.danger, flex: 1 }}>
              Worth a look
            </Text>
          </View>
          <Text variant="body" color="secondary">
            {summary.painOrFatigueConcern}
          </Text>
        </Card>
      ) : null}

      {summary.newPersonalRecords.length > 0 ? (
        <Card variant="flat" style={{ gap: theme.spacing.xs }}>
          <Text variant="subtitle">New personal records</Text>
          {summary.newPersonalRecords.map(pr => (
            <ListRow
              key={`${pr.exerciseId}-${pr.loggedAt}`}
              title={pr.exerciseName}
              subtitle={`${formatWeight(pr.loadKg, unitPref)}${unitLabel(unitPref)} × ${pr.reps} (est. 1RM ${Math.round(
                pr.e1rm,
              )}${unitLabel(unitPref)})`}
              icon="trophy"
            />
          ))}
        </Card>
      ) : null}

      {summary.bestSet ? (
        <Card variant="flat" style={{ gap: theme.spacing.xs }}>
          <Text variant="subtitle">Best set</Text>
          <Text variant="body" color="secondary">
            {summary.bestSet.exerciseName} — {formatWeight(summary.bestSet.loadKg, unitPref)}
            {unitLabel(unitPref)} × {summary.bestSet.reps}
          </Text>
        </Card>
      ) : null}

      {summary.improvedExercises.length > 0 || summary.declinedExercises.length > 0 ? (
        <Card variant="flat" style={{ gap: theme.spacing.xs }}>
          <Text variant="subtitle">Compared with last time</Text>
          {summary.improvedExercises.map(e => (
            <ListRow key={e.exerciseId} title={e.exerciseName} subtitle={e.detail} icon="trendingUp" />
          ))}
          {summary.declinedExercises.map(e => (
            <ListRow key={e.exerciseId} title={e.exerciseName} subtitle={e.detail} icon="trendingDown" />
          ))}
        </Card>
      ) : null}

      <Card variant="flat" style={{ gap: theme.spacing.sm }}>
        <ListRow
          title="Volume"
          subtitle={
            summary.volumeChangePercent != null
              ? `${summary.volumeChangePercent >= 0 ? '+' : ''}${Math.round(summary.volumeChangePercent)}% vs. last time`
              : 'No prior session to compare yet'
          }
          trailing={
            <Text variant="body">
              {formatVolume(summary.totalVolumeKg, unitPref)} {unitLabel(unitPref)}
            </Text>
          }
        />
        <ListRow
          title="Target RPE adherence"
          subtitle={
            summary.rpeAdherence.ratedSetCount > 0
              ? `${summary.rpeAdherence.onTargetSetCount}/${summary.rpeAdherence.ratedSetCount} sets within 1 of target`
              : 'No target RPE to compare'
          }
        />
        {summary.readinessVsPerformance ? (
          <ListRow title="Readiness vs. performance" subtitle={summary.readinessVsPerformance} />
        ) : null}
        <ListRow title="Estimated recovery needs" subtitle={RECOVERY_LABEL[summary.estimatedRecoveryNeeds]} />
        <ListRow title="Suggested next action" subtitle={summary.suggestedNextAction} />
      </Card>
    </>
  );
}
