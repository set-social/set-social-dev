import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Card } from './Card';
import { Numeral } from './Numeral';
import { Text } from './Text';
import { Icon } from './Icon';

type StatTileProps = {
  label: string;
  value: string | number;
  trend?: { direction: 'up' | 'down' | 'flat'; label: string };
};

/** The label/value/trend content shared by the Card-wrapped `StatTile` below
 * and any caller that needs the same look composed into a layout of its own
 * — e.g. several stats sharing one outer card as evenly-spaced columns
 * instead of each getting its own bordered tile (see StatsRail). */
export function StatTileBody({ label, value, trend }: StatTileProps) {
  const theme = useTheme();
  const trendColor =
    trend?.direction === 'up'
      ? theme.colors.semantic.success
      : trend?.direction === 'down'
        ? theme.colors.semantic.danger
        : theme.colors.text.secondary;
  const trendIcon = trend?.direction === 'up' ? 'trendingUp' : trend?.direction === 'down' ? 'trendingDown' : 'minus';

  return (
    <View style={{ gap: theme.spacing.xxs }}>
      <Text variant="label" color="secondary">
        {label.toUpperCase()}
      </Text>
      <Numeral value={value} size="md" />
      {trend ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xxs }}>
          <Icon name={trendIcon} size="sm" color={trendColor} />
          <Text variant="caption" style={{ color: trendColor }}>
            {trend.label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function StatTile({ label, value, trend }: StatTileProps) {
  const theme = useTheme();
  return (
    <Card variant="subtle" style={{ padding: theme.spacing.sm }}>
      <StatTileBody label={label} value={value} trend={trend} />
    </Card>
  );
}
