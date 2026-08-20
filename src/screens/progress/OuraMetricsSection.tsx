import React, { useCallback } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Card, ProgressRing, LoadingState } from '../../components/core';
import { useIntegrationConnections } from '../../services/api/queries/integrations';
import { useOuraMetrics, useSyncOuraMetrics } from '../../services/api/queries/oura';

/** Readiness/sleep/activity rings for the Stats tab — same shape as
 * WhoopMetricsSection, mounted alongside it so an athlete with both
 * wearables connected sees both. Manages its own connected/loading/error
 * states independently so it never waits on the unrelated PR data query.
 * Renders nothing at all when Oura isn't connected — Stats only shows tiles
 * for wearables actually connected; the "go connect it" pitch lives on the
 * Integrations screen instead, not as a prompt tile in here. */
export function OuraMetricsSection({ userId }: { userId: string | null }) {
  const theme = useTheme();
  const { data: connections, isLoading: connectionsLoading } = useIntegrationConnections(userId);
  const isConnected = connections?.find(c => c.provider === 'oura')?.access_token != null;

  const { data: metrics, isLoading: metricsLoading } = useOuraMetrics(isConnected ? userId : null);
  const syncMetrics = useSyncOuraMetrics();

  // Fire-and-forget background sync whenever this screen regains focus —
  // useOuraMetrics's cached row already rendered, so a slow or failed sync
  // here should never block or blank the section.
  useFocusEffect(
    useCallback(() => {
      if (isConnected && userId) {
        syncMetrics.mutate(userId);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isConnected, userId]),
  );

  if (connectionsLoading) {
    return null;
  }

  if (!isConnected) {
    return null;
  }

  if (metricsLoading && !metrics) {
    return (
      <Card variant="elevated">
        <LoadingState fill={false} label="Syncing Oura data..." />
      </Card>
    );
  }

  // Oura has no score_state/PENDING_SCORE concept — a row simply doesn't
  // exist yet until Oura has scored the day, so "not yet scored" is just
  // "no row" here, unlike WhoopMetricsSection's score_state check.
  if (!metrics) {
    return (
      <Card variant="elevated">
        <Text variant="subtitle">Oura</Text>
        <Text variant="body" color="secondary" style={{ marginTop: theme.spacing.xs }}>
          No Oura data yet today — check back after your next sleep.
        </Text>
      </Card>
    );
  }

  return (
    <Card variant="elevated">
      <Text variant="subtitle">Oura</Text>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-around',
          marginTop: theme.spacing.md,
        }}
      >
        <ProgressRing
          progress={metrics.readiness_score != null ? metrics.readiness_score / 100 : 0}
          size={88}
          strokeWidth={8}
          centerValueSize="sm"
          centerValue={metrics.readiness_score != null ? `${metrics.readiness_score}%` : '—'}
          label="Readiness"
        />
        <ProgressRing
          progress={metrics.sleep_score != null ? metrics.sleep_score / 100 : 0}
          size={88}
          strokeWidth={8}
          centerValueSize="sm"
          colors={theme.gradients.sleep}
          centerValue={metrics.sleep_score != null ? `${metrics.sleep_score}%` : '—'}
          label="Sleep"
        />
        <ProgressRing
          progress={metrics.activity_score != null ? metrics.activity_score / 100 : 0}
          size={88}
          strokeWidth={8}
          centerValueSize="sm"
          colors={theme.gradients.activity}
          centerValue={metrics.activity_score != null ? `${metrics.activity_score}%` : '—'}
          label="Activity"
        />
      </View>
    </Card>
  );
}
