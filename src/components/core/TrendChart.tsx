import React, { useState } from 'react';
import { View, Pressable, type GestureResponderEvent } from 'react-native';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import { format, parseISO } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from './Text';

type TrendChartProps = {
  points: number[];
  height?: number;
  emptyLabel?: string;
  /** ISO yyyy-MM-dd, parallel to `points` — enables axis labels and dated
   * tooltips. Omitted by callers with no per-point date (e.g. a single
   * exercise's e1RM history keyed by event, not by calendar day). */
  dates?: string[];
  /** Formats a raw point value for the tooltip and delta line. Defaults to
   * a plain rounded, comma-grouped number. */
  valueFormatter?: (value: number) => string;
  /** Opt-in: renders a "vs previous period" summary line above the chart
   * and switches the line/fill color to reflect the sign of the change
   * (up = success green, down = danger red). Omitted entirely — not just
   * hidden — when the caller doesn't pass it, so charts that never asked
   * for this (Weight trend, e1RM progression, readiness) keep their exact
   * current look.
   */
  deltaVsPrevious?: {
    current: number;
    previous: number;
    /** e.g. "vs previous 7 days" */
    label: string;
  } | null;
};

const defaultValueFormatter = (value: number) => Math.round(value).toLocaleString();

export function TrendChart({
  points,
  height = 120,
  emptyLabel = 'Not enough data yet',
  dates,
  valueFormatter = defaultValueFormatter,
  deltaVsPrevious,
}: TrendChartProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="caption" color="secondary">
          {emptyLabel}
        </Text>
      </View>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const padding = 8;

  const coords =
    width > 0
      ? points.map((p, i) => ({
          x: padding + (i * (width - padding * 2)) / (points.length - 1),
          y: padding + (1 - (p - min) / range) * (height - padding * 2),
        }))
      : [];
  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
  const areaPath =
    coords.length > 0
      ? `${linePath} L ${coords[coords.length - 1].x} ${height} L ${coords[0].x} ${height} Z`
      : '';

  // Only switches away from the brand accent when the caller actually opted
  // into delta tracking — see the prop's own doc comment.
  const trendColor =
    deltaVsPrevious == null
      ? theme.colors.accent.primary
      : deltaVsPrevious.current >= deltaVsPrevious.previous
      ? theme.colors.semantic.success
      : theme.colors.semantic.danger;

  const onChartPress = (e: GestureResponderEvent) => {
    if (coords.length === 0) return;
    const x = e.nativeEvent.locationX;
    let nearest = 0;
    let nearestDist = Infinity;
    coords.forEach((c, i) => {
      const dist = Math.abs(c.x - x);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    });
    setActiveIndex(current => (current === nearest ? null : nearest));
  };

  const active = activeIndex != null ? coords[activeIndex] : null;
  const tooltipWidth = 96;
  const tooltipLeft =
    active != null ? Math.min(Math.max(active.x - tooltipWidth / 2, 0), Math.max(width - tooltipWidth, 0)) : 0;

  return (
    <View style={{ gap: theme.spacing.xs }}>
      {deltaVsPrevious ? (
        <DeltaLine
          current={deltaVsPrevious.current}
          previous={deltaVsPrevious.previous}
          label={deltaVsPrevious.label}
          valueFormatter={valueFormatter}
        />
      ) : null}

      <View
        testID="trend-chart-measure"
        style={{ height }}
        onLayout={e => setWidth(e.nativeEvent.layout.width)}
      >
        {width > 0 ? (
          <Pressable testID="trend-chart-touch-area" onPress={onChartPress} style={{ width, height }}>
            <Svg width={width} height={height}>
              <Path d={areaPath} fill={trendColor} fillOpacity={0.08} />
              <Path
                d={linePath}
                stroke={trendColor}
                strokeWidth={2}
                fill="none"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {active ? (
                <>
                  <Line
                    x1={active.x}
                    y1={0}
                    x2={active.x}
                    y2={height}
                    stroke={theme.colors.border.default}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  <Circle cx={active.x} cy={active.y} r={4} fill={trendColor} />
                </>
              ) : null}
            </Svg>

            {active && activeIndex != null ? (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: tooltipLeft,
                  top: Math.max(active.y - 44, 0),
                  width: tooltipWidth,
                  backgroundColor: theme.colors.bg.surfaceElevated,
                  borderWidth: 1,
                  borderColor: theme.colors.border.default,
                  borderRadius: theme.radii.sm,
                  paddingVertical: 4,
                  paddingHorizontal: 6,
                  alignItems: 'center',
                }}
              >
                {dates?.[activeIndex] ? (
                  <Text variant="caption" color="tertiary" style={{ fontSize: 10 }}>
                    {format(parseISO(dates[activeIndex]), 'MMM d')}
                  </Text>
                ) : null}
                <Text variant="caption" style={{ fontWeight: '700' }}>
                  {valueFormatter(points[activeIndex])}
                </Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}
      </View>

      {dates && dates.length === points.length ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="caption" color="tertiary" style={{ fontSize: 10 }}>
            {format(parseISO(dates[0]), 'MMM d')}
          </Text>
          {dates.length > 2 ? (
            <Text variant="caption" color="tertiary" style={{ fontSize: 10 }}>
              {format(parseISO(dates[Math.floor((dates.length - 1) / 2)]), 'MMM d')}
            </Text>
          ) : null}
          <Text variant="caption" color="tertiary" style={{ fontSize: 10 }}>
            {format(parseISO(dates[dates.length - 1]), 'MMM d')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function DeltaLine({
  current,
  previous,
  label,
  valueFormatter,
}: {
  current: number;
  previous: number;
  label: string;
  valueFormatter: (value: number) => string;
}) {
  const theme = useTheme();

  if (previous <= 0) {
    return (
      <Text variant="caption" color="secondary">
        {current > 0 ? `${valueFormatter(current)} ${label}` : `No data ${label}`}
      </Text>
    );
  }

  const changePercent = ((current - previous) / previous) * 100;
  const isUp = current >= previous;
  const color = isUp ? theme.colors.semantic.success : theme.colors.semantic.danger;
  const arrow = isUp ? '▲' : '▼';

  return (
    <Text variant="caption">
      <Text variant="caption" style={{ color, fontWeight: '700' }}>
        {arrow} {Math.abs(changePercent).toFixed(0)}%
      </Text>
      <Text variant="caption" color="secondary">
        {' '}
        {label}
      </Text>
    </Text>
  );
}
