import React, { useEffect } from 'react';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Icon } from '../../components/core';

type PrBannerProps = {
  /** Bump this (e.g. an incrementing counter) to replay the animation — a
   * boolean wouldn't re-fire on two consecutive same-value triggers, which
   * back-to-back PRs on different sets in the same session can easily
   * produce. 0 means "never shown yet." */
  trigger: number;
};

const VISIBLE_MS = 2200;

/** Celebratory banner for a new PR just hit mid-workout — slides down,
 * holds, then slides away on its own. Purely presentational; the caller
 * (ActiveExerciseScreen) decides when a just-completed set actually beat a
 * prior best and provides the positioned container this renders into —
 * it must be the nearest `position: 'relative'` ancestor, placed below the
 * screen's own header rather than the SafeAreaView's top edge, so this
 * never overlaps the status bar / Dynamic Island. */
export function PrBanner({ trigger }: PrBannerProps) {
  const theme = useTheme();
  const translateY = useSharedValue(-80);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (trigger === 0) return;
    translateY.value = -80;
    opacity.value = 0;
    translateY.value = withSequence(
      withSpring(0, { damping: 14, stiffness: 180 }),
      withDelay(VISIBLE_MS, withTiming(-80, { duration: 250 })),
    );
    opacity.value = withSequence(
      withTiming(1, { duration: 200 }),
      withDelay(VISIBLE_MS, withTiming(0, { duration: 250 })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        {
          position: 'absolute',
          top: theme.spacing.md,
          left: theme.spacing.lg,
          right: theme.spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing.sm,
          backgroundColor: theme.colors.accent.primary,
          borderRadius: theme.radii.md,
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.spacing.md,
          ...theme.shadows.lg,
          // Above the exercise header/rest banner/etc. — a higher, explicit
          // value rather than shadows.lg's own (elevation is Android-only;
          // zIndex covers iOS stacking too).
          zIndex: 20,
          elevation: 20,
        },
        style,
      ]}
    >
      <Icon name="trophy" size="md" color={theme.colors.text.onAccent} />
      <Text variant="subtitle" style={{ color: theme.colors.text.onAccent, fontWeight: '800' }}>
        You hit a new PR!
      </Text>
    </Animated.View>
  );
}
