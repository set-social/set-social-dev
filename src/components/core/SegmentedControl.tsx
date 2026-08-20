import React from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from './Text';

type SegmentedControlProps<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: theme.colors.bg.surface,
        borderRadius: theme.radii.sm,
        borderWidth: 1,
        borderColor: theme.colors.border.subtle,
        padding: theme.spacing.xxs,
      }}
    >
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={{
              flex: 1,
              minHeight: theme.sizes.touchTarget - theme.spacing.xs,
              paddingVertical: theme.spacing.xs,
              borderRadius: theme.radii.xs,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected ? theme.colors.accent.primary : 'transparent',
            }}
          >
            <Text
              variant="caption"
              style={{
                color: selected ? theme.colors.text.onAccent : theme.colors.text.secondary,
                fontWeight: '700',
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
