import React, { useEffect, useState } from 'react';
import { View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import LinearGradient from 'react-native-linear-gradient';
import { SetSocialIcon, Text } from '../components/core';
import { useTheme } from '../theme/ThemeProvider';

// Mirrors LoadingScreen's constants exactly — same mark asset, same
// correction factors, so the two screens' marks sit pixel-identically and
// swapping between them (see RootNavigator) never produces a visible jump.
const MARK_ASPECT = 220 / 174;
const MARK_WIDTH_FRACTION = 0.24;
const GLOW_TO_MARK_WIDTH_RATIO = 2.1;
const MARK_VISUAL_OFFSET_X_FRACTION = 13 / 220;
const MARK_VISUAL_OFFSET_Y_FRACTION = 1.5 / 174;
const HAIRLINE_WIDTH_FRACTION = 0.22;
const HAIRLINE_SEGMENT_FRACTION = 0.42;
const BREATH_LEG_MS = 2400;
const HAIRLINE_LEG_MS = 1400;
// Mark: a swift coin-flip illusion via a scaleX squash, not a true 3D
// rotateY — mirrors LoadingScreen's own flip exactly, including why it's
// scaleX and not rotateY now. See that file's comment on markStyle for why.
const FLIP_DURATION_MS = 550;
const FLIP_CYCLE_MS = 2000;

type ProLoadingScreenProps = {
  label?: string;
};

/**
 * Pro counterpart to LoadingScreen (screens/LoadingScreen.tsx) — shown
 * instead of it, for the same gating window in RootNavigator, whenever the
 * warmed profile cache says the signed-in athlete is on SetSocial Pro.
 * Identical animation/layout to LoadingScreen so switching between the two
 * reads as "the same screen, recolored," not a different loading path;
 * only the glow hue, hairline gradient, and the added PRO wordmark
 * differ — see theme.gradients.premium's own comment for why it's a
 * distinct blue rather than reusing an existing accent.
 */
export function ProLoadingScreen({ label = 'Loading SetSocial Pro' }: ProLoadingScreenProps) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();

  const breath = useSharedValue(0);
  const hairlineSlide = useSharedValue(0);
  const flip = useSharedValue(0);
  // Measured (not computed) position of the mark, relative to the same
  // parent the PRO wordmark below is positioned against — real layout
  // rather than reconstructing Yoga's own math by hand, which is what
  // shifted the *glow* out of place the first time this bug was fixed (an
  // extra wrapper View around glow+mark changed which parent's
  // alignItems/justifyContent the absolutely-positioned glow inherited).
  // Keeping glow and mark direct children of the same centered container
  // LoadingScreen uses — completely unchanged from LoadingScreen's own
  // structure — avoids that trap; only the PRO label's own position needs
  // computing, from this measurement.
  const [markLayout, setMarkLayout] = useState<{ y: number; height: number } | null>(null);
  const onMarkLayout = (event: LayoutChangeEvent) => {
    const { y, height: measuredHeight } = event.nativeEvent.layout;
    setMarkLayout({ y, height: measuredHeight });
  };

  useEffect(() => {
    if (reducedMotion) {
      breath.value = 0.5;
      hairlineSlide.value = 1;
      flip.value = 0;
      return;
    }
    breath.value = withRepeat(withTiming(1, { duration: BREATH_LEG_MS, easing: Easing.inOut(Easing.sin) }), -1, true);
    hairlineSlide.value = withRepeat(withTiming(1, { duration: HAIRLINE_LEG_MS, easing: Easing.inOut(Easing.cubic) }), -1, false);
    flip.value = withRepeat(
      withSequence(
        withTiming(360, { duration: FLIP_DURATION_MS, easing: Easing.out(Easing.cubic) }),
        withTiming(360, { duration: FLIP_CYCLE_MS - FLIP_DURATION_MS }),
      ),
      -1,
      false,
    );
  }, [reducedMotion, breath, hairlineSlide, flip]);

  const glowStyle = useAnimatedStyle(() => {
    // Matches the mark's own scaleX squash below exactly (same |cos(θ)|
    // curve) — the glow's visual weight now tracks the mark's actual
    // rendered width frame for frame, not just approximately.
    const foreshorten = Math.max(0.35, Math.abs(Math.cos((flip.value * Math.PI) / 180)));
    return {
      opacity: interpolate(breath.value, [0, 1], [0.45, 0.8]) * foreshorten,
      transform: [{ scale: interpolate(breath.value, [0, 1], [1, 1.12]) }],
    };
  });
  const markStyle = useAnimatedStyle(() => {
    // scaleX squash, not a true 3D rotateY — see LoadingScreen's markStyle
    // for the full reasoning (a real rotateY on this flat, mostly-
    // transparent PNG produced the reported blue-tint artifact partway
    // through the spin, on both screens, surviving two other targeted
    // fixes first).
    const scaleX = Math.max(0.02, Math.abs(Math.cos((flip.value * Math.PI) / 180)));
    return { transform: [{ scaleX }] };
  });

  const markWidth = width * MARK_WIDTH_FRACTION;
  const markHeight = markWidth / MARK_ASPECT;
  const markCorrectionX = markWidth * MARK_VISUAL_OFFSET_X_FRACTION;
  const markCorrectionY = markHeight * MARK_VISUAL_OFFSET_Y_FRACTION;
  const glowSize = markWidth * GLOW_TO_MARK_WIDTH_RATIO;
  const trackWidth = width * HAIRLINE_WIDTH_FRACTION;
  const segmentWidth = trackWidth * HAIRLINE_SEGMENT_FRACTION;

  const segmentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(hairlineSlide.value, [0, 1], [-segmentWidth, trackWidth]) }],
  }));

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg.base, overflow: 'hidden' }}>
      <Svg style={{ position: 'absolute' }} width={width} height={height}>
        <Defs>
          <RadialGradient id="premiumBlobTop" cx="70%" cy="15%" r="45%">
            <Stop offset="0%" stopColor={theme.gradients.premium[1]} stopOpacity={0.16} />
            <Stop offset="55%" stopColor={theme.gradients.premium[1]} stopOpacity={0.06} />
            <Stop offset="100%" stopColor={theme.gradients.premium[1]} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="premiumBlobBottom" cx="20%" cy="85%" r="55%">
            <Stop offset="0%" stopColor={theme.gradients.premium[1]} stopOpacity={0.12} />
            <Stop offset="55%" stopColor={theme.gradients.premium[1]} stopOpacity={0.04} />
            <Stop offset="100%" stopColor={theme.gradients.premium[1]} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#premiumBlobTop)" />
        <Rect x={0} y={0} width={width} height={height} fill="url(#premiumBlobBottom)" />
      </Svg>

      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        accessible
        accessibilityLabel={label}
      >
        {/* glow, mark, and track are direct children of this container, in
            exactly the same order/props as LoadingScreen's own — nothing
            about their nesting differs, so both the mark's centered
            position (see below) and the glow's own position (an absolute
            view with no explicit offsets inherits its parent's
            alignItems/justifyContent in RN — the same quirk that centers it
            behind the mark at all) come out pixel-identical between the two
            screens. Only [mark, track] are real flex children (glow is
            absolute, contributing no measured height); the PRO wordmark
            below is positioned from a real layout measurement instead of
            being a third flex sibling here, since adding it as one would
            make this screen's centered stack taller than LoadingScreen's
            and shift the mark upward the instant RootNavigator swaps one
            screen for the other — the exact bug this structure exists to
            avoid. */}
        <Animated.View testID="pro-loading-glow" style={[{ position: 'absolute', width: glowSize, height: glowSize }, glowStyle]}>
          <Svg width={glowSize} height={glowSize} viewBox="0 0 100 100">
            <Defs>
              <RadialGradient id="markGlowPremium" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={theme.gradients.premium[0]} stopOpacity={0.5} />
                <Stop offset="55%" stopColor={theme.gradients.premium[1]} stopOpacity={0.18} />
                <Stop offset="100%" stopColor={theme.gradients.premium[1]} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={50} cy={50} r={50} fill="url(#markGlowPremium)" />
          </Svg>
        </Animated.View>

        <Animated.View
          testID="pro-loading-mark"
          style={markStyle}
          onLayout={onMarkLayout}
        >
          <View style={{ transform: [{ translateX: markCorrectionX }, { translateY: markCorrectionY }] }}>
            <SetSocialIcon size={markWidth} accessibilityLabel="" />
          </View>
        </Animated.View>

        {markLayout ? (
          <View
            style={{
              position: 'absolute',
              top: markLayout.y + markLayout.height + theme.spacing.sm,
              left: 0,
              right: 0,
              alignItems: 'center',
            }}
          >
            <Text
              variant="label"
              style={{
                color: theme.gradients.premium[1],
                letterSpacing: 3,
                fontWeight: '700',
              }}
            >
              PRO
            </Text>
          </View>
        ) : null}

        <View
          style={{
            // Track sits `theme.spacing.xxxl` below the mark (its previous
            // flex sibling), not `xl` — the PRO label is absolutely
            // positioned in that same gap (mark bottom + spacing.sm, ~24px
            // tall including its line height), so `xl` left it landing
            // almost flush against the track's top edge with ~0px to
            // breathe. `xxxl` leaves a real gap between the two instead.
            marginTop: theme.spacing.xxxl,
            width: trackWidth,
            height: 3,
            borderRadius: theme.radii.pill,
            backgroundColor: theme.colors.bg.surfaceElevated,
            overflow: 'hidden',
          }}
        >
          <Animated.View
            style={[
              { width: segmentWidth, height: 3, borderRadius: theme.radii.pill, overflow: 'hidden' },
              segmentStyle,
            ]}
          >
            <LinearGradient
              colors={[...theme.gradients.premium]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ width: '100%', height: '100%' }}
            />
          </Animated.View>
        </View>
      </View>
    </View>
  );
}
