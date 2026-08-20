import React, { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type ViewProps } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeProvider';

/** Border/wash opacities tuned specifically for this treatment — not
 * theme.colors.accent.subtle (0.12), which is meant for flat fills, not a
 * border or a corner wash meant to read as distinct from a plain Card. */
const BORDER_COLOR = 'rgba(0, 227, 142, 0.5)';
const GREEN_WASH_OPACITY = 0.22;
const PURPLE_WASH_OPACITY = 0.2;
/** Fraction of the card's diagonal each bloom's radius reaches. Sized off
 * the real measured diagonal (see below) rather than a percentage of
 * width/height independently, so it scales sensibly on both a roughly-square
 * card and a short, wide one. */
const BLOOM_RADIUS_FACTOR = 0.8;

/**
 * "Corner Bloom" — the visual signature for cards carrying AI-composed
 * content (Coach Summary, the post-workout flip card): a green hairline
 * border plus a soft green/purple radial wash bleeding in from opposite
 * corners, sitting behind the card's normal content. Deliberately a wash
 * rather than a hard gradient ring — this app's shadow tokens are explicit
 * about "soft lifts, not glow effects" (see theme/tokens.ts), and this stays
 * consistent with that restraint while still reading as distinct from a
 * plain elevated Card.
 *
 * The gradient circles are drawn in real measured pixels
 * (gradientUnits="userSpaceOnUse") rather than react-native-svg's default
 * objectBoundingBox percentages — on a card much wider than it is tall
 * (Coach Summary), objectBoundingBox stretches the circle into a
 * non-uniform ellipse that some platforms clip to a hard-edged square
 * instead of fading smoothly. A real circle sized off the card's own
 * diagonal has no such platform-dependent stretch to go wrong.
 *
 * A drop-in replacement for `<Card variant="elevated">`, not a Card prop,
 * since the wash needs an absolutely-positioned Svg layer under the content
 * that a plain style override can't express.
 */
export function AiCard({ style, children, onLayout, ...rest }: ViewProps) {
  const theme = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
    onLayout?.(event);
  };

  const radius = Math.sqrt(size.width ** 2 + size.height ** 2) * BLOOM_RADIUS_FACTOR;

  return (
    <View
      style={[
        {
          borderRadius: theme.radii.lg,
          borderWidth: 1,
          borderColor: BORDER_COLOR,
          backgroundColor: theme.colors.bg.surfaceElevated,
          padding: theme.spacing.md,
          gap: theme.spacing.sm,
          overflow: 'hidden',
        },
        theme.shadows.md,
        style,
      ]}
      onLayout={handleLayout}
      {...rest}
    >
      {size.width > 0 && size.height > 0 ? (
        <Svg style={StyleSheet.absoluteFill} width={size.width} height={size.height} pointerEvents="none">
          <Defs>
            <RadialGradient id="aiCardBloomGreen" cx={0} cy={0} r={radius} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={theme.colors.accent.primary} stopOpacity={GREEN_WASH_OPACITY} />
              <Stop offset="1" stopColor={theme.colors.accent.primary} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient
              id="aiCardBloomPurple"
              cx={size.width}
              cy={size.height}
              r={radius}
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0" stopColor={theme.colors.accent.purple} stopOpacity={PURPLE_WASH_OPACITY} />
              <Stop offset="1" stopColor={theme.colors.accent.purple} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={size.width} height={size.height} fill="url(#aiCardBloomGreen)" />
          <Rect x={0} y={0} width={size.width} height={size.height} fill="url(#aiCardBloomPurple)" />
        </Svg>
      ) : null}
      {children}
    </View>
  );
}
