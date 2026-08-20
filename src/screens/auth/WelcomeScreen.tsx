import React from 'react';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Button, SetSocialLogo } from '../../components/core';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Welcome'>;

// Full-bleed hero behind the welcome/sign-in entry point — own backgrounds/
// folder (not branding/, which is logo marks only) since this is marketing
// art, not a brand asset.
const BACKDROP_SOURCE = require('../../assets/backgrounds/sign-in-backdrop.png');
// Source file's real pixel dimensions — needed to size the rendered box by
// the photo's own aspect ratio (see backdropSize below), not just a percent
// of the screen on each axis independently, which doesn't preserve it.
const BACKDROP_ASPECT_RATIO = 853 / 1844; // width / height
// How much of the screen the backdrop should fill on its binding axis —
// close to 1 so there's no visible dark margin ("black edges") on a device
// whose aspect ratio is close to the photo's own (most phones), while still
// never cropping on a device where it isn't (resizeMode="contain" below).
const BACKDROP_SCALE = 0.98;

/** Fits BACKDROP_ASPECT_RATIO into `scale` of the given screen size,
 * picking whichever axis actually constrains it — so the rendered box's
 * aspect ratio always exactly matches the source photo's, on any device.
 * (The previous version scaled width/height independently by the same
 * factor, which only preserves the photo's aspect ratio when the screen's
 * own ratio happens to match it — everywhere else it left `contain` adding
 * extra, inconsistent letterboxing on top of the intended margin.) */
export function fitBackdrop(screenWidth: number, screenHeight: number, scale: number): { width: number; height: number } {
  const maxWidth = screenWidth * scale;
  const maxHeight = screenHeight * scale;
  let width = maxWidth;
  let height = width / BACKDROP_ASPECT_RATIO;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * BACKDROP_ASPECT_RATIO;
  }
  return { width, height };
}

// Scrim stops: a vignette darkest right where the centered content sits
// (the middle band), tapering to a lighter edge at the very top/bottom so
// some of the photo still shows through — dark enough everywhere that the
// wordmark/tagline/buttons stay legible regardless of what's underneath.
const SCRIM_COLORS = [
  'rgba(6,8,12,0.55)',
  'rgba(6,8,12,0.68)',
  'rgba(6,8,12,0.80)',
  'rgba(6,8,12,0.80)',
  'rgba(6,8,12,0.68)',
  'rgba(6,8,12,0.55)',
] as const;
const SCRIM_LOCATIONS = [0, 0.25, 0.42, 0.58, 0.75, 1] as const;

export function WelcomeScreen({ navigation }: Props) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const backdropSize = fitBackdrop(width, height, BACKDROP_SCALE);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      {/* Box sized from the photo's own aspect ratio, not the screen's — so
          resizeMode="contain" has nothing left to letterbox on the binding
          axis, and only the intentional 2% margin (BACKDROP_SCALE) shows,
          consistently, whatever this device's screen ratio actually is. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}
      >
        <Image source={BACKDROP_SOURCE} resizeMode="contain" style={backdropSize} />
      </View>
      <LinearGradient
        colors={[...SCRIM_COLORS]}
        locations={[...SCRIM_LOCATIONS]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <SafeAreaView style={{ flex: 1, justifyContent: 'flex-end', paddingHorizontal: theme.spacing.xl }}>
        <View style={{ alignItems: 'center', gap: theme.spacing.xl, paddingBottom: theme.spacing.xl }}>
          <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <SetSocialLogo variant="horizontal" size={40} accessibilityLabel="SetSocial" />
            <Text variant="body" color="secondary" style={{ textAlign: 'center' }}>
              Sets made{' '}
              <Text variant="body" style={{ color: theme.colors.accent.blue, fontWeight: '700' }}>
                Social
              </Text>
            </Text>
          </View>

          <View style={{ gap: theme.spacing.md, width: '100%' }}>
            <Button label="Sign In" onPress={() => navigation.navigate('SignIn')} />
            <Button
              label="Create Account"
              variant="secondary"
              onPress={() => navigation.navigate('SignUp')}
            />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}
