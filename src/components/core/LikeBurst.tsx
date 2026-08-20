import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeProvider';

const EMOJI_SIZE = 96;
const BADGE_SIZE = EMOJI_SIZE * 0.72;

type LikeBurstProps = {
  /** Bump this (e.g. an incrementing counter) to replay the animation —
   * a boolean wouldn't re-fire the effect on two consecutive same-value
   * triggers, which a double-tap can easily produce. */
  trigger: number;
};

/** Instagram-style double-tap-to-like pop, centered over its parent (which
 * must be position:relative). Purely presentational — the caller decides
 * when to bump `trigger` and whether the tap should actually (un)like
 * anything.
 *
 * The 💪 glyph itself can't be recolored (Unicode emoji render as fixed
 * full-color glyphs in RN, ignoring `color`/tint styles) — the brand green
 * comes from a circular badge behind it instead, which also gives the burst
 * a solid anchor shape rather than a bare emoji floating on the photo. */
export function LikeBurst({ trigger }: LikeBurstProps) {
  const theme = useTheme();
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (trigger === 0) return;
    scale.value = 0;
    opacity.value = 1;
    scale.value = withSequence(
      withSpring(1.25, { damping: 8, stiffness: 200 }),
      withSpring(1, { damping: 12 }),
    );
    opacity.value = withDelay(450, withTiming(0, { duration: 250 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
          // Explicit stacking (not just JSX order) so this reliably renders
          // above the photo Image on both platforms.
          zIndex: 10,
          elevation: 10,
        },
        style,
      ]}
    >
      <View
        style={{
          width: BADGE_SIZE,
          height: BADGE_SIZE,
          borderRadius: BADGE_SIZE / 2,
          backgroundColor: theme.colors.accent.primary,
          alignItems: 'center',
          justifyContent: 'center',
          ...theme.shadows.lg,
        }}
      >
        <Text style={{ fontSize: EMOJI_SIZE * 0.5 }}>💪</Text>
      </View>
    </Animated.View>
  );
}
