import React, { useEffect } from 'react';
import { View, useWindowDimensions } from 'react-native';
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
import { SetSocialIcon } from '../components/core';
import { useTheme } from '../theme/ThemeProvider';

// Matches SetSocialIcon's real mark asset (setsocial-mark.png, 220x174) —
// for the icon-only path, `size` maps directly to width (see SetSocialLogo).
const MARK_ASPECT = 220 / 174;
const MARK_WIDTH_FRACTION = 0.24;
const GLOW_TO_MARK_WIDTH_RATIO = 2.1;

// The source asset's visible glyph isn't drawn centered within its own
// 220x174 canvas — measured bounding box of the opaque pixels sits ~5.9%
// left and ~0.9% above the canvas's true center. Both the mark and the
// hairline track below it are laid out with identical centering logic, so
// without this correction the mark visibly sits left of the track instead
// of stacking on the same center line.
const MARK_VISUAL_OFFSET_X_FRACTION = 13 / 220;
const MARK_VISUAL_OFFSET_Y_FRACTION = 1.5 / 174;

const HAIRLINE_WIDTH_FRACTION = 0.22;
const HAIRLINE_SEGMENT_FRACTION = 0.42;

// Glow: opacity/scale pulses on a ~2.4s breathing cycle behind the mark.
// Hairline: a single highlight segment sweeps the track and snaps back, the
// classic indeterminate-progress motion — no separate reverse slide.
const BREATH_LEG_MS = 2400;
const HAIRLINE_LEG_MS = 1400;

// Mark: a swift coin-flip illusion — a scaleX squash through |cos(θ)| as
// `flip` sweeps 0-360deg (see markStyle), not a true 3D rotateY, which
// produced a real rendering artifact partway through the spin (see
// markStyle's own comment) — then holds at rest for the remainder of a
// fixed FLIP_CYCLE_MS-long loop. withRepeat's non-reverse "snap back to
// start" between cycles is invisible here since 360deg and 0deg produce the
// same |cos| value.
const FLIP_DURATION_MS = 550;
const FLIP_CYCLE_MS = 2000;

/** RootNavigator holds this screen up for exactly this long (a hard cap, not
 * just a minimum) — breathing/hairline keep looping the whole time
 * regardless. */
export const MIN_DISPLAY_DURATION_MS = 4000;

type LoadingScreenProps = {
  /** Accessibility label for the splash's status region. */
  label?: string;
};

/**
 * Full-bleed branded loading screen shown while app-level state that gates
 * navigation — auth hydration, then (once signed in) warming the query cache
 * for Today's data — is still resolving. Not the same as LoadingState
 * (components/core), which stays a small inline spinner used throughout
 * individual screens' own data-loading states.
 *
 * Deliberately restrained: icon mark only (no wordmark image, whose aspect
 * ratio scales unpredictably with brand-name length — see git history for
 * the sizing bug that motivated dropping it here), no cycling status copy —
 * a slim animated progress hairline communicates "loading" instead. Ambient
 * blue/purple radial glows plus a breathing teal halo behind the mark carry
 * the same premium mood the previous photo-background treatment aimed for,
 * without the visual noise.
 */
export function LoadingScreen({ label = 'Loading SetSocial' }: LoadingScreenProps) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();

  const breath = useSharedValue(0);
  const hairlineSlide = useSharedValue(0);
  const flip = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      // Static, resting values — no breathing, no hairline sweep, no flip.
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
    // A 2D scaleX squash, not a true 3D rotateY — real perspective+rotateY
    // on this flat, mostly-transparent PNG produced a genuine rendering
    // artifact partway through the spin (part of the mark visibly tinting
    // blue), on both this screen and ProLoadingScreen, that survived two
    // targeted attempts at a fix (rasterizing the layer, dimming the glow
    // behind it). RN's rotateY has no real "back face" for a single flat
    // image — past 90deg it shows a mirrored render of the same content,
    // and whatever's going wrong happens in that mirrored/edge-on range.
    // scaleX reproduces the identical "turning edge-on and back" illusion
    // via the same |cos(θ)| width falloff a real rotation would show, but
    // it only ever squashes the same, already-correctly-colored pixels —
    // there's no back face, no perspective, no rendering path left for a
    // different color to appear.
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
          <RadialGradient id="blueBlob" cx="70%" cy="15%" r="45%">
            <Stop offset="0%" stopColor={theme.colors.accent.blue} stopOpacity={0.16} />
            <Stop offset="55%" stopColor={theme.colors.accent.blue} stopOpacity={0.06} />
            <Stop offset="100%" stopColor={theme.colors.accent.blue} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="purpleBlob" cx="20%" cy="85%" r="55%">
            <Stop offset="0%" stopColor={theme.colors.accent.purple} stopOpacity={0.14} />
            <Stop offset="55%" stopColor={theme.colors.accent.purple} stopOpacity={0.05} />
            <Stop offset="100%" stopColor={theme.colors.accent.purple} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#blueBlob)" />
        <Rect x={0} y={0} width={width} height={height} fill="url(#purpleBlob)" />
      </Svg>

      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        accessible
        accessibilityLabel={label}
      >
        <Animated.View style={[{ position: 'absolute', width: glowSize, height: glowSize }, glowStyle]}>
          <Svg width={glowSize} height={glowSize} viewBox="0 0 100 100">
            <Defs>
              <RadialGradient id="markGlow" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={theme.colors.accent.teal} stopOpacity={0.5} />
                <Stop offset="55%" stopColor={theme.colors.accent.teal} stopOpacity={0.18} />
                <Stop offset="100%" stopColor={theme.colors.accent.teal} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={50} cy={50} r={50} fill="url(#markGlow)" />
          </Svg>
        </Animated.View>

        <Animated.View style={markStyle}>
          <View style={{ transform: [{ translateX: markCorrectionX }, { translateY: markCorrectionY }] }}>
            <SetSocialIcon size={markWidth} accessibilityLabel="" />
          </View>
        </Animated.View>

        <View
          style={{
            marginTop: theme.spacing.xl,
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
              colors={[...theme.gradients.accent]}
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
