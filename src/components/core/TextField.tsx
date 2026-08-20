import React, { forwardRef, useState } from 'react';
import { TextInput, TextInputProps, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from './Text';

type TextFieldProps = TextInputProps & {
  label?: string;
  error?: string;
};

// forwardRef so a caller can imperatively .focus() this field (e.g.
// ChatScreen focusing the input when opened via the widget's "Log Food"
// deep link) — additive, every existing non-ref usage is unaffected.
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextFieldInner(
  { label, error, style, onFocus, onBlur, ...rest },
  ref,
) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? theme.colors.semantic.danger
    : focused
      ? theme.colors.accent.primary
      : theme.colors.border.default;

  return (
    <View style={{ gap: theme.spacing.xs }}>
      {label ? (
        <Text variant="label" color="secondary">
          {label.toUpperCase()}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor={theme.colors.text.tertiary}
        onFocus={e => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={e => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          {
            backgroundColor: theme.colors.bg.surface,
            borderWidth: 1,
            borderColor,
            borderRadius: theme.radii.md,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.md,
            color: theme.colors.text.primary,
            fontSize: 15,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text variant="caption" style={{ color: theme.colors.semantic.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
});
