import React from 'react';
import { Text as RNText } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

type NumeralProps = {
  value: string | number;
  size?: 'xl' | 'lg' | 'md' | 'sm';
  color?: string;
};

/** Big, heavy, tabular-figure numeral used for PRs/stats across the app. */
export function Numeral({ value, size = 'lg', color }: NumeralProps) {
  const theme = useTheme();
  const variant =
    size === 'xl' ? 'numeralXl' : size === 'md' ? 'numeralMd' : size === 'sm' ? 'numeralSm' : 'numeralLg';
  return (
    <RNText
      style={[
        theme.typography[variant],
        {
          color: color ?? theme.colors.text.primary,
          fontVariant: ['tabular-nums'],
        },
      ]}
    >
      {value}
    </RNText>
  );
}
