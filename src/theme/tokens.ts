/**
 * SetSocial design tokens — dark, premium athletic-tech system (green-to-teal
 * primary accent, blue/purple/orange secondary accents). Single source of
 * truth for color/spacing/radius/shadow/typography. Every screen and
 * component should read from here rather than hardcoding values.
 *
 * Dark is the app's default and primary-designed look (see
 * themePreferenceStore) — `darkColors` below is that original palette,
 * unchanged. `lightColors` is a second palette, same structure, for athletes
 * who prefer a bright UI.
 */

type ColorPalette = {
  bg: { base: string; surface: string; surfaceElevated: string };
  border: { default: string; subtle: string };
  text: { primary: string; secondary: string; tertiary: string; onAccent: string };
  accent: {
    primary: string;
    primaryPressed: string;
    subtle: string;
    teal: string;
    blue: string;
    purple: string;
    orange: string;
  };
  semantic: { success: string; warning: string; danger: string };
};

export const darkColors: ColorPalette = {
  bg: {
    base: '#090B10',
    surface: '#171B23',
    surfaceElevated: '#1D222C',
  },
  border: {
    default: '#29303C',
    subtle: 'rgba(255,255,255,0.06)',
  },
  text: {
    primary: '#F2F4F7',
    secondary: '#A7AFBD',
    tertiary: '#737C8C',
    onAccent: '#04140D',
  },
  accent: {
    // Was #00E38E (green) — swapped to this cyan-teal per the reviewed
    // accent-color-preview mockup. primaryPressed/subtle recomputed at the
    // same ratio to the old values (pressed ≈87% brightness, subtle same
    // alpha) rather than hand-picked, so the relationships between them stay
    // exactly what they were.
    primary: '#00F5D4',
    primaryPressed: '#00D6B9',
    subtle: 'rgba(0,245,212,0.12)',
    /** Secondary brand accents — one per purpose (info/social = blue,
     * AI/insight = purple, share/energy = orange), never competing with the
     * primary accent within the same element. */
    teal: '#00D8B4',
    blue: '#00BFFF',
    purple: '#7861FF',
    orange: '#FF8A3D',
  },
  semantic: {
    success: '#00F5D4',
    warning: '#FFB454',
    danger: '#FF5D6C',
  },
};

/**
 * Light palette. Same brand hues as `darkColors`, not just an inverted
 * lightness ramp — every accent that also gets used as icon/text foreground
 * (see e.g. EnergyTodayCard, WeekTimeline, CoachSummaryBody) is deepened
 * enough to clear ~3:1 contrast against a white surface, since the vivid
 * dark-mode values (e.g. `#00F5D4`, `#00BFFF`) read at ~1.7–2.1:1 on white
 * and disappear. Filled surfaces (buttons, badges, gradients) aren't
 * affected by this and keep reading as clearly on-brand.
 */
export const lightColors: ColorPalette = {
  bg: {
    base: '#F4F5F7',
    surface: '#FFFFFF',
    /** Same white as `surface` — on a light background, elevation reads
     * through the `shadows` tokens (iOS-style lift), not through a lightness
     * step the way dark mode's surface → surfaceElevated ramp works. */
    surfaceElevated: '#FFFFFF',
  },
  border: {
    default: '#E1E4EA',
    subtle: 'rgba(15,23,32,0.06)',
  },
  text: {
    primary: '#12151B',
    secondary: '#5B6472',
    tertiary: '#8A93A3',
    onAccent: '#04140D',
  },
  accent: {
    // Deepened from the new dark-mode #00F5D4 the same way the old #00E38E
    // was deepened to #00A968 — reduced in HSL lightness (same hue/
    // saturation) until it clears ~3:1 contrast on white again, since a
    // naive same-ratio RGB scale undershoots for a cyan this saturated
    // (blue contributes little to perceived luminance, so a cyan-heavy
    // color needs deepening further than a pure-green one for the same
    // contrast). primaryPressed/subtle recomputed at the same ratios as
    // the dark palette's own primary->primaryPressed/subtle step.
    primary: '#00A38D',
    primaryPressed: '#008E7B',
    subtle: 'rgba(0,163,141,0.10)',
    teal: '#00897B',
    blue: '#0077B6',
    purple: '#6A4FE8',
    orange: '#D9660A',
  },
  semantic: {
    success: '#00A38D',
    warning: '#C97A00',
    danger: '#E0324A',
  },
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radii = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/**
 * Cross-platform elevation: pairs iOS shadow props with an Android `elevation`
 * fallback so a single token produces a consistent-looking lift on both.
 * Kept restrained — the brand direction explicitly avoids large uncontrolled
 * shadows/glows, so these are soft lifts, not glow effects.
 */
export const shadows = {
  sm: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.16,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
  },
  lg: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 10,
  },
} as const;

/**
 * Color stops for react-native-linear-gradient/react-native-svg, start-to-end.
 * These are vivid filled sweeps (buttons, rings, badges) rather than flat
 * text/background colors, so — unlike `colors.accent` — they don't need
 * theme-specific deepening for contrast and stay identical between
 * `darkGradients`/`lightGradients`. Only `surface`, a background sweep,
 * actually differs by theme.
 */
const brandGradients = {
  /** The brand's signature accent sweep — buttons, the logo mark,
   * celebratory moments. Was green-to-teal (#00E38E -> #00D8B4); now a
   * cyan-to-sky-blue sweep off the new #00F5D4 primary, same subtle
   * within-family hue shift the old sweep had. */
  accent: ['#00F5D4', '#00D4F5'] as const,
  /** Wearable metric rings (Stats tab) — one distinct sweep per metric so
   * three rings shown side by side read as separate things, not variants of
   * the same accent. Recovery uses the default `accent` sweep above. */
  sleep: ['#00BFFF', '#0090C7'] as const,
  strain: ['#FF8A3D', '#FF6A00'] as const,
  /** Oura's activity ring — distinct from strain's orange sweep since
   * they're different metrics (daily movement adequacy vs. workout
   * exertion), even though both are the "third ring" for their wearable. */
  activity: ['#7C5CFC', '#5B3DF5'] as const,
  /** SetSocial Pro's one accent — a warm gold, deliberately distinct from
   * every other gradient in the app so Pro-context UI (paywall, badge, the
   * Pro loading screen) reads as its own "premium" color. Used only in
   * Pro-specific contexts — everywhere else keeps the normal accent/gradient
   * system untouched. */
  premium: ['#F6D786', '#C9971E'] as const,
} as const;

type GradientPalette = {
  accent: readonly [string, string];
  surface: readonly [string, string];
  sleep: readonly [string, string];
  strain: readonly [string, string];
  activity: readonly [string, string];
  premium: readonly [string, string];
};

export const darkGradients: GradientPalette = {
  ...brandGradients,
  surface: ['#1D222C', '#171B23'],
};

export const lightGradients: GradientPalette = {
  ...brandGradients,
  surface: ['#FFFFFF', '#F4F5F7'],
};

export const sizes = {
  touchTarget: 44,
  iconButton: 40,
  icon: { sm: 16, md: 20, lg: 24 },
} as const;

/**
 * The brand board specifies Inter. No font binaries are bundled in this repo
 * yet — bundling real Inter .ttf files and linking them via
 * `react-native.config.js` assets + `npx react-native-asset` is a follow-up
 * step outside what can be done here (see the branding report). Until then
 * this stays `undefined`, which falls back to the platform system font
 * (SF Pro / Roboto) — visually close to Inter (both are grotesque-style
 * humanist sans-serifs) and keeps the app dependency-free in the meantime.
 * Once real font files are added, set these to the linked family names
 * (e.g. 'Inter-Regular', 'Inter-Bold') and thread `fontFamily` through
 * `components/core/Text.tsx` and `Numeral.tsx`.
 */
export const fontFamily = {
  numeral: undefined,
  body: undefined,
} as const;

export const typography = {
  display: { fontSize: 32, fontWeight: '800' as const, letterSpacing: -0.5, lineHeight: 38 },
  numeralXl: { fontSize: 56, fontWeight: '900' as const, letterSpacing: -1, lineHeight: 58 },
  numeralLg: { fontSize: 36, fontWeight: '900' as const, letterSpacing: -0.5, lineHeight: 40 },
  numeralMd: { fontSize: 24, fontWeight: '800' as const, letterSpacing: -0.25, lineHeight: 28 },
  numeralSm: { fontSize: 18, fontWeight: '700' as const, letterSpacing: -0.1, lineHeight: 22 },
  title: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.2, lineHeight: 26 },
  subtitle: { fontSize: 16, fontWeight: '600' as const, lineHeight: 22 },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 21 },
  caption: { fontSize: 13, fontWeight: '500' as const, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: '600' as const, letterSpacing: 0.4, lineHeight: 16 },
} as const;

export type ColorTokens = ColorPalette;
export type TypographyVariant = keyof typeof typography;
