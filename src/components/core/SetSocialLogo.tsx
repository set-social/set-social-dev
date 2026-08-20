import React from 'react';
import { Image, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from './Text';

export type SetSocialLogoVariant = 'icon' | 'horizontal' | 'stacked';
export type SetSocialLogoTheme = 'light-on-dark' | 'dark-on-light';

type SetSocialLogoProps = {
  /** 'icon' = mark only, 'horizontal' = mark + wordmark side-by-side, 'stacked' = mark above wordmark. */
  variant?: SetSocialLogoVariant;
  /** 'light-on-dark' (default) is the primary treatment for this app's dark backgrounds. */
  theme?: SetSocialLogoTheme;
  /** Height of the mark in px — the wordmark (horizontal/stacked) scales off this. */
  size?: number;
  /** Announced by screen readers; defaults to "SetSocial". Pass "" only when an adjacent element already labels this logo, to avoid double-announcing. */
  accessibilityLabel?: string;
};

// Real exported brand assets, processed into transparent-background PNGs —
// see src/assets/branding/. Only a light-on-dark version exists since this
// app has no light theme anywhere; dark-on-light below is a geometric SVG
// approximation kept as a documented fallback for if/when a light surface
// ever needs the mark.
const MARK_SOURCE = require('../../assets/branding/setsocial-mark.png');
const WORDMARK_SOURCE = require('../../assets/branding/setsocial-wordmark.png');
/** Native pixel aspect ratios of the source assets — used to size the Image from a single `size` prop. */
const MARK_ASPECT = 220 / 174;
const WORDMARK_ASPECT = 711 / 129;

/**
 * Stroke-only rendering of the mark — no fill — for contexts that need the
 * brand mark as a single-color glyph (tab bar icons, the dark-on-light
 * fallback below) rather than the full-color raster lockup.
 */
export function SetSocialMarkOutline({
  size,
  color,
  strokeWidth = 20,
}: {
  size: number;
  color?: string;
  strokeWidth?: number;
}) {
  const theme = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path
        d="M72,24 C72,10 28,12 28,32 C28,52 72,48 72,68 C72,88 28,86 26,74"
        fill="none"
        stroke={color ?? theme.colors.bg.base}
        strokeWidth={strokeWidth}
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </Svg>
  );
}

/** Icon-only mark — app icon reference, tab bars, compact headers. */
export function SetSocialIcon({
  size = 32,
  theme = 'light-on-dark',
  accessibilityLabel = 'SetSocial',
}: {
  size?: number;
  theme?: SetSocialLogoTheme;
  accessibilityLabel?: string;
}) {
  return (
    <View accessible={accessibilityLabel !== ''} accessibilityRole="image" accessibilityLabel={accessibilityLabel || undefined}>
      {theme === 'light-on-dark' ? (
        <Image source={MARK_SOURCE} style={{ width: size, height: size / MARK_ASPECT }} resizeMode="contain" />
      ) : (
        <SetSocialMarkOutline size={size} />
      )}
    </View>
  );
}

export function SetSocialLogo({ variant = 'icon', theme = 'light-on-dark', size = 32, accessibilityLabel = 'SetSocial' }: SetSocialLogoProps) {
  const appTheme = useTheme();

  if (variant === 'icon') {
    return <SetSocialIcon size={size} theme={theme} accessibilityLabel={accessibilityLabel} />;
  }

  if (variant === 'horizontal' && theme === 'light-on-dark') {
    // The real combined mark+wordmark lockup, used exactly as designed —
    // no separate mark/text composition needed for this treatment.
    const height = size;
    const width = height * WORDMARK_ASPECT;
    return (
      <Image
        source={WORDMARK_SOURCE}
        style={{ width, height }}
        resizeMode="contain"
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel || undefined}
      />
    );
  }

  // 'stacked' (no stacked source asset exists, only the horizontal lockup),
  // or 'horizontal' in the dark-on-light treatment — compose the real mark
  // with a code-rendered two-tone wordmark instead.
  const onDark = theme === 'light-on-dark';
  const setColor = onDark ? appTheme.colors.text.primary : appTheme.colors.bg.base;
  const socialColor = appTheme.colors.accent.primary;
  const wordmarkFontSize = size * 0.9;

  // The wordmark is rendered visually (Set/Social two-tone) but hidden from
  // the accessibility tree — the wrapping View below carries the single
  // "SetSocial" label so a screen reader announces it once, not "Set Social"
  // split oddly.
  const wordmarkText = (
    <Text
      importantForAccessibility="no"
      style={{
        fontSize: wordmarkFontSize,
        fontWeight: '800',
        letterSpacing: -0.5,
        lineHeight: wordmarkFontSize * 1.1,
      }}
    >
      <Text style={{ fontSize: wordmarkFontSize, fontWeight: '800', color: setColor }}>Set</Text>
      <Text style={{ fontSize: wordmarkFontSize, fontWeight: '800', color: socialColor }}>Social</Text>
    </Text>
  );

  const containerStyle =
    variant === 'stacked'
      ? { alignItems: 'center' as const, gap: size * 0.15 }
      : { flexDirection: 'row' as const, alignItems: 'center' as const, gap: size * 0.2 };

  return (
    <View style={containerStyle} accessible={accessibilityLabel !== ''} accessibilityRole="image" accessibilityLabel={accessibilityLabel || undefined}>
      <SetSocialIcon size={size} theme={theme} accessibilityLabel="" />
      {wordmarkText}
    </View>
  );
}
