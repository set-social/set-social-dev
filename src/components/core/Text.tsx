import React from 'react';
import { Text as RNText, TextProps as RNTextProps } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import type { TypographyVariant } from '../../theme/tokens';

type TextProps = RNTextProps & {
  variant?: TypographyVariant;
  color?: 'primary' | 'secondary' | 'tertiary' | 'onAccent';
};

export function Text({ variant = 'body', color = 'primary', style, ...rest }: TextProps) {
  const theme = useTheme();
  return (
    <RNText
      style={[
        theme.typography[variant],
        { color: theme.colors.text[color] },
        style,
      ]}
      {...rest}
    />
  );
}
