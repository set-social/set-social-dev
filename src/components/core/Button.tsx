import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import LinearGradient from 'react-native-linear-gradient';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';

type ButtonSize = 'sm' | 'md' | 'lg';
type ButtonVariant = 'primary' | 'secondary' | 'ghost';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconPosition?: 'leading' | 'trailing';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  /** Overrides the default accent sweep for a `primary` button — e.g.
   * `theme.gradients.premium` for a paywall CTA. Ignored for other variants. */
  gradientColors?: readonly [string, string];
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'leading',
  disabled,
  loading,
  style,
  gradientColors,
}: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const backgroundColor =
    variant === 'secondary'
      ? theme.colors.bg.surfaceElevated
      : variant === 'ghost'
        ? 'transparent'
        : undefined;

  const textColor =
    variant === 'primary' ? theme.colors.text.onAccent : theme.colors.text.primary;

  const sizeStyle =
    size === 'sm'
      ? { paddingVertical: theme.spacing.xs, paddingHorizontal: theme.spacing.md }
      : size === 'lg'
        ? { paddingVertical: theme.spacing.lg, paddingHorizontal: theme.spacing.xxl }
        : { paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.xl };

  const textVariant = size === 'sm' ? 'body' : 'subtitle';
  const iconSize = size === 'sm' ? 'sm' : 'md';

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => {
        scale.value = withTiming(0.97, { duration: 90 });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: 120 });
      }}
      disabled={isDisabled}
      hitSlop={size === 'sm' ? 6 : undefined}
      style={[
        {
          minHeight: size === 'sm' ? undefined : theme.sizes.touchTarget,
          backgroundColor,
          borderRadius: theme.radii.md,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: theme.colors.border.default,
          opacity: isDisabled ? 0.4 : 1,
          overflow: 'hidden',
        },
        pressStyle,
        style,
      ]}
    >
      {variant === 'primary' ? (
        <LinearGradient
          colors={gradientColors ? [...gradientColors] : [...theme.gradients.accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing.xs,
          minHeight: size === 'sm' ? undefined : theme.sizes.touchTarget,
          ...sizeStyle,
        }}
      >
        {loading ? (
          <ActivityIndicator color={textColor} />
        ) : (
          <>
            {icon && iconPosition === 'leading' ? (
              <Icon name={icon} size={iconSize} color={textColor} />
            ) : null}
            <Text variant={textVariant} style={{ color: textColor, fontWeight: '600' }}>
              {label}
            </Text>
            {icon && iconPosition === 'trailing' ? (
              <Icon name={icon} size={iconSize} color={textColor} />
            ) : null}
          </>
        )}
      </View>
    </AnimatedPressable>
  );
}
