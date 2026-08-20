import React from 'react';
import { Pressable, ViewStyle } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';

type IconButtonProps = {
  name: IconName;
  onPress: () => void;
  variant?: 'filled' | 'ghost';
  size?: number;
  color?: string;
  disabled?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
};

/** Circular icon-only pressable with a real touch target, used for every
 * back/close/action glyph in the app so hit areas stay consistent. */
export function IconButton({
  name,
  onPress,
  variant = 'filled',
  size,
  color,
  disabled,
  style,
  accessibilityLabel,
}: IconButtonProps) {
  const theme = useTheme();
  const dimension = size ?? theme.sizes.iconButton;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [
        {
          width: dimension,
          height: dimension,
          borderRadius: theme.radii.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor:
            variant === 'filled' ? theme.colors.bg.surfaceElevated : 'transparent',
          opacity: disabled ? 0.35 : pressed ? 0.6 : 1,
        },
        style,
      ]}
    >
      <Icon name={name} size="sm" color={color ?? theme.colors.text.primary} />
    </Pressable>
  );
}
