import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeProvider';
import { Numeral } from './Numeral';
import { Text } from './Text';

type ProgressRingProps = {
  /** 0..1 */
  progress: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  centerValue?: string;
  /** Size of the centered numeral — defaults to 'md' (the existing look for
   * every other ring). Smaller rings with a label underneath the value (e.g.
   * Whoop's recovery/sleep/strain rings) read cleaner with 'sm'. */
  centerValueSize?: 'xl' | 'lg' | 'md' | 'sm';
  /** Gradient stops for the filled arc — defaults to the brand green-teal
   * sweep. Pass a different token (e.g. theme.gradients.sleep) when several
   * rings appear together and need to read as distinct metrics. */
  colors?: readonly [string, string];
};

export function ProgressRing({
  progress,
  size = 120,
  strokeWidth = 10,
  label,
  centerValue,
  centerValueSize = 'md',
  colors,
}: ProgressRingProps) {
  const theme = useTheme();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));
  const dashOffset = circumference * (1 - clamped);
  const gradientId = 'progressRingGradient';
  const [stopStart, stopEnd] = colors ?? theme.gradients.accent;

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={stopStart} />
            <Stop offset="100%" stopColor={stopEnd} />
          </LinearGradient>
        </Defs>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={theme.colors.border.subtle}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        {centerValue ? <Numeral value={centerValue} size={centerValueSize} /> : null}
        {label ? (
          <Text variant="caption" color="secondary">
            {label}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
