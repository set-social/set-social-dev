import React, { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { format } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Card, Icon, ProgressRing, StatTileBody, LoadingState } from '../../components/core';
import { useIntegrationConnections } from '../../services/api/queries/integrations';
import { useWhoopMetrics, useSyncWhoopMetrics } from '../../services/api/queries/whoop';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import { formatSkinTemp } from '../../utils/units';

/** "1h 28m" / "42m" — sleep-stage and sleep-debt durations are stored in
 * whole minutes (see 0074_whoop_sleep_detail.sql); nothing else in this app
 * currently formats a duration this way, so it stays local rather than
 * becoming a shared util for one caller. */
function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Recovery/sleep/strain rings for the Stats tab — sits above the PR
 * content and manages its own connected/loading/error states independently
 * so it never waits on the unrelated PR data query. Shows an explicit "not
 * connected" card rather than rendering nothing — Stats should always say
 * something about Whoop status rather than silently omitting the section,
 * with the actual "go connect it" flow living on the Integrations screen. */
export function WhoopMetricsSection({ userId }: { userId: string | null }) {
  const theme = useTheme();
  const unitPref = useUnitPreference();
  const [detailOpen, setDetailOpen] = useState(false);
  const { data: connections, isLoading: connectionsLoading } = useIntegrationConnections(userId);
  const isConnected = connections?.find(c => c.provider === 'whoop')?.access_token != null;

  const { data: metrics, isLoading: metricsLoading } = useWhoopMetrics(isConnected ? userId : null);
  const syncMetrics = useSyncWhoopMetrics();
  // useWhoopMetrics fetches only the single latest row, which can still be
  // `SCORED` from a prior day if today hasn't synced yet — compare against
  // today's date so that stale row renders as "no data yet" instead of
  // silently showing yesterday's (or older) rings as if they were current.
  const isFromToday = metrics != null && metrics.cycle_date === format(new Date(), 'yyyy-MM-dd');

  // Fire-and-forget background sync whenever this screen regains focus —
  // useWhoopMetrics's cached row already rendered, so a slow or failed sync
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
    return (
      <Card variant="elevated">
        <Text variant="subtitle">Whoop</Text>
        <Text variant="body" color="secondary" style={{ marginTop: theme.spacing.xs }}>
          Not connected — connect Whoop in Integrations to see your recovery, sleep, and strain here.
        </Text>
      </Card>
    );
  }

  if (metricsLoading && !metrics) {
    return (
      <Card variant="elevated">
        <LoadingState fill={false} label="Syncing Whoop data..." />
      </Card>
    );
  }

  // score_state only reflects the cycle/strain score, which WHOOP doesn't
  // finalize until the next sleep begins — recovery and sleep performance
  // come from separate endpoints and are commonly available well before
  // that. Only show "no data" when every metric is actually missing, so a
  // pending strain score doesn't hide already-available recovery/sleep data.
  if (
    !metrics ||
    !isFromToday ||
    (metrics.recovery_score == null &&
      metrics.sleep_performance_pct == null &&
      metrics.strain == null)
  ) {
    return (
      <Card variant="elevated">
        <Text variant="subtitle">Whoop</Text>
        <Text variant="body" color="secondary" style={{ marginTop: theme.spacing.xs }}>
          No Whoop data yet today — check back after your next sleep.
        </Text>
      </Card>
    );
  }

  const strainPending = metrics.score_state !== 'SCORED';
  const hasBiostats = metrics.hrv_ms != null || metrics.resting_heart_rate != null;

  // Sleep-stage minutes are only meaningful together — a bar built from a
  // partial set (e.g. REM present, the other three null-coerced to 0) would
  // understate the night rather than honestly show "not enough data", so
  // the whole bar+legend needs every one of the four.
  const stageMinutes =
    metrics.rem_sleep_minutes != null &&
    metrics.deep_sleep_minutes != null &&
    metrics.light_sleep_minutes != null &&
    metrics.awake_minutes != null
      ? {
          rem: metrics.rem_sleep_minutes,
          deep: metrics.deep_sleep_minutes,
          light: metrics.light_sleep_minutes,
          awake: metrics.awake_minutes,
        }
      : null;
  const stageTotal = stageMinutes ? stageMinutes.rem + stageMinutes.deep + stageMinutes.light + stageMinutes.awake : 0;

  const hasSleepDetail =
    stageMinutes != null ||
    metrics.sleep_efficiency_pct != null ||
    metrics.sleep_consistency_pct != null ||
    metrics.respiratory_rate != null ||
    metrics.spo2_pct != null ||
    metrics.skin_temp_celsius != null ||
    metrics.sleep_debt_minutes != null;

  return (
    <Card variant="elevated">
      <Text variant="subtitle">Whoop</Text>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-around',
          marginTop: theme.spacing.md,
        }}
      >
        <ProgressRing
          progress={metrics.recovery_score != null ? metrics.recovery_score / 100 : 0}
          size={88}
          strokeWidth={8}
          centerValueSize="sm"
          centerValue={metrics.recovery_score != null ? `${metrics.recovery_score}%` : '—'}
          label="Recovery"
        />
        <ProgressRing
          progress={metrics.sleep_performance_pct != null ? metrics.sleep_performance_pct / 100 : 0}
          size={88}
          strokeWidth={8}
          centerValueSize="sm"
          colors={theme.gradients.sleep}
          centerValue={metrics.sleep_performance_pct != null ? `${metrics.sleep_performance_pct}%` : '—'}
          label="Sleep"
        />
        <ProgressRing
          progress={strainPending ? 0 : metrics.strain != null ? metrics.strain / 21 : 0}
          size={88}
          strokeWidth={8}
          centerValueSize="sm"
          colors={theme.gradients.strain}
          centerValue={strainPending ? 'Pending' : metrics.strain != null ? metrics.strain.toFixed(1) : '—'}
          label="Strain"
        />
      </View>

      {/* HRV/resting heart rate were already fetched and stored on every
          sync (whoop_metrics.hrv_ms/resting_heart_rate) but never rendered
          here — plain text under the rings rather than a 4th/5th ring, same
          "keep the hero visualization uncluttered" call as the Stats tab's
          Muscle Heat Map. Same divider convention as VitalsTile's segmented
          row (Home tab). */}
      {hasBiostats ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            marginTop: theme.spacing.md,
            paddingTop: theme.spacing.md,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border.subtle,
          }}
        >
          <View style={{ flex: 1 }}>
            <StatTileBody
              label="HRV"
              value={metrics.hrv_ms != null ? `${metrics.hrv_ms} ms` : '—'}
            />
          </View>
          <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: theme.colors.border.subtle }} />
          <View style={{ flex: 1 }}>
            <StatTileBody
              label="Resting HR"
              value={metrics.resting_heart_rate != null ? `${metrics.resting_heart_rate} bpm` : '—'}
            />
          </View>
        </View>
      ) : null}

      {/* Everything in here needed a new column + a parsing fix in
          whoop-sync (see 0074_whoop_sleep_detail.sql) — WHOOP already
          returns it on the /recovery and /activity/sleep calls this
          function makes, it just wasn't stored before. Collapsed by
          default, same "don't let the rings stop being the headline" call
          as the biostat row above, just one tier further. */}
      {hasSleepDetail ? (
        <>
          <Pressable
            onPress={() => setDetailOpen(open => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: detailOpen }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: theme.spacing.md,
              paddingTop: theme.spacing.md,
              borderTopWidth: 1,
              borderTopColor: theme.colors.border.subtle,
            }}
          >
            <Text variant="body" style={{ fontWeight: '600' }}>
              More details
            </Text>
            <Icon
              name={detailOpen ? 'chevronUp' : 'chevronDown'}
              size="sm"
              color={theme.colors.text.tertiary}
            />
          </Pressable>

          {detailOpen ? (
            <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.md }}>
              {stageMinutes && stageTotal > 0 ? (
                <View style={{ gap: theme.spacing.sm }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      height: 8,
                      borderRadius: theme.radii.xs,
                      overflow: 'hidden',
                    }}
                  >
                    <View style={{ flex: stageMinutes.rem, backgroundColor: theme.colors.accent.purple }} />
                    <View style={{ flex: stageMinutes.deep, backgroundColor: theme.colors.accent.blue }} />
                    <View style={{ flex: stageMinutes.light, backgroundColor: theme.colors.accent.teal }} />
                    <View style={{ flex: Math.max(stageMinutes.awake, 0.001), backgroundColor: theme.colors.border.default }} />
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                    <StageLegendItem color={theme.colors.accent.purple} label={`REM ${formatMinutes(stageMinutes.rem)}`} />
                    <StageLegendItem color={theme.colors.accent.blue} label={`Deep ${formatMinutes(stageMinutes.deep)}`} />
                    <StageLegendItem color={theme.colors.accent.teal} label={`Light ${formatMinutes(stageMinutes.light)}`} />
                    <StageLegendItem color={theme.colors.border.default} label={`Awake ${formatMinutes(stageMinutes.awake)}`} />
                  </View>
                </View>
              ) : null}

              <View style={{ gap: theme.spacing.md }}>
                <DetailStatRow
                  left={{ label: 'Efficiency', value: metrics.sleep_efficiency_pct != null ? `${metrics.sleep_efficiency_pct}%` : '—' }}
                  right={{ label: 'Consistency', value: metrics.sleep_consistency_pct != null ? `${metrics.sleep_consistency_pct}%` : '—' }}
                />
                <DetailStatRow
                  left={{ label: 'Resp. rate', value: metrics.respiratory_rate != null ? `${metrics.respiratory_rate}/min` : '—' }}
                  right={{ label: 'SpO2', value: metrics.spo2_pct != null ? `${metrics.spo2_pct}%` : '—' }}
                />
                <DetailStatRow
                  left={{ label: 'Skin temp', value: formatSkinTemp(metrics.skin_temp_celsius, unitPref) }}
                  right={{
                    label: 'Sleep debt',
                    value: metrics.sleep_debt_minutes != null ? formatMinutes(metrics.sleep_debt_minutes) : '—',
                  }}
                />
              </View>
            </View>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

function StageLegendItem({ color, label }: { color: string; label: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xxs, flexShrink: 1 }}>
      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color, flexShrink: 0 }} />
      <Text variant="caption" color="tertiary" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Same label-over-value StatTileBody treatment as the HRV/Resting HR row
 * above — one visual language for every metric pair on this card, rather
 * than a second, boxed "chip" style invented just for this section. Two
 * evenly-split columns per row is also what actually fixes the real bug
 * report: a 3-per-row layout left too little width for "Consistency" at
 * label size + letter-spacing, so it wrapped and orphaned the last letter.
 */
function DetailStatRow({
  left,
  right,
}: {
  left: { label: string; value: string };
  right: { label: string; value: string };
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      <View style={{ flex: 1 }}>
        <StatTileBody label={left.label} value={left.value} />
      </View>
      <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: theme.colors.border.subtle }} />
      <View style={{ flex: 1 }}>
        <StatTileBody label={right.label} value={right.value} />
      </View>
    </View>
  );
}
