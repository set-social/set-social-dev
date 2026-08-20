import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Icon, IconButton, type IconName } from '../../components/core';
import type { ReadinessBand, ReadinessFactor, ReadinessResult } from '../../services/coaching';

type CoachSummaryBodyProps = {
  headline: string;
  summary: string;
  band: ReadinessBand | null;
  isRestDay: boolean;
  readiness?: ReadinessResult | null;
  onDismiss: () => void;
};

function iconFor(band: ReadinessBand | null, isRestDay: boolean): IconName {
  if (isRestDay) return 'moon';
  if (band === 'high' || band === 'moderate') return 'megaphone';
  if (band === 'low' || band === 'very_low') return 'moon';
  return 'info';
}

// Icon shape is driven by the factor's own `trend` when it has one (the
// arrow should show which way the underlying metric is moving) — falling
// back to `impact` only for factors where no explicit trend was set, since
// for most of them trend and readiness-valence point the same direction
// anyway.
function impactIcon(factor: ReadinessFactor): IconName {
  if (factor.trend === 'up') return 'trendingUp';
  if (factor.trend === 'down') return 'trendingDown';
  if (factor.trend === 'flat') return 'minus';
  if (factor.impact === 'positive') return 'trendingUp';
  if (factor.impact === 'negative') return 'trendingDown';
  return 'minus';
}

// Icon *color* always reads as "is this good news" — green for positive,
// red for negative — which is `displayImpact` when a factor sets one
// (training load: high volume is good news even though it dings predicted
// readiness) and `impact` otherwise.
function impactColor(factor: ReadinessFactor): 'positive' | 'negative' | 'neutral' {
  return factor.displayImpact ?? factor.impact;
}

/** The header/dismiss/headline/summary/"See why" content shared by
 * AiSummaryCard (standalone) and TodayHeroCard (merged into today's plan) —
 * pulled out so neither has to duplicate this JSX. Purely presentational: no
 * outer card wrapper, no dismissed-check — both of those stay with whichever
 * parent is mounting this. */
export function CoachSummaryBody({ headline, summary, band, isRestDay, readiness, onDismiss }: CoachSummaryBodyProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  // Only factors with a real signal behind them (a check-in was logged, a
  // wearable is connected) are worth showing — evaluateReadiness always
  // returns all nine, `available: false` and all, so this is the one place
  // that distinction actually matters.
  const availableFactors = (readiness?.factors ?? []).filter(factor => factor.available);

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Icon name={iconFor(band, isRestDay)} size="md" color={theme.colors.accent.primary} />
        <Text variant="subtitle" style={{ flex: 1 }}>
          Arnold's Summary
        </Text>
        <IconButton name="x" variant="ghost" size={28} accessibilityLabel="Dismiss coach summary" onPress={onDismiss} />
      </View>
      {headline ? (
        <Text variant="body" style={{ fontWeight: '700' }}>
          {headline}
        </Text>
      ) : null}
      <Text variant="body" color="secondary">
        {summary}
      </Text>

      {availableFactors.length > 0 ? (
        <>
          <Pressable
            onPress={() => setExpanded(current => !current)}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Hide readiness breakdown' : 'See why'}
            style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: theme.spacing.xxs }}
          >
            <Text variant="caption" style={{ color: theme.colors.accent.primary, fontWeight: '700' }}>
              {expanded ? 'Hide breakdown' : 'See why'}
            </Text>
            <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size="sm" color={theme.colors.accent.primary} />
          </Pressable>

          {expanded ? (
            <View style={{ gap: theme.spacing.sm, paddingTop: theme.spacing.xxs }}>
              {availableFactors.map(factor => (
                <View key={factor.key} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm }}>
                  <Icon
                    name={impactIcon(factor)}
                    size="sm"
                    color={
                      impactColor(factor) === 'positive'
                        ? theme.colors.accent.primary
                        : impactColor(factor) === 'negative'
                          ? theme.colors.semantic.danger
                          : theme.colors.text.tertiary
                    }
                  />
                  <View style={{ flex: 1 }}>
                    <Text variant="caption" style={{ fontWeight: '700' }}>
                      {factor.label}
                    </Text>
                    <Text variant="caption" color="secondary">
                      {factor.detail}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </>
  );
}
