import React, { useEffect, useState } from 'react';
import { NavigationContainer, DarkTheme, Theme as NavTheme, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import { useAuthStore } from '../store/authStore';
import { useTheme } from '../theme/ThemeProvider';
import { useAppBootstrap } from '../hooks/useAppBootstrap';
import { LoadingScreen, MIN_DISPLAY_DURATION_MS } from '../screens/LoadingScreen';
import { ProLoadingScreen } from '../screens/ProLoadingScreen';
import { useProfile } from '../services/api/queries/profiles';
import { AuthStack } from './AuthStack';
import { OnboardingStack } from './OnboardingStack';
import { AppShell } from './AppShell';
import { ProfileStack } from './ProfileStack';
import { ChatScreen } from '../screens/chat/ChatScreen';
import { PaywallScreen } from '../screens/profile/PaywallScreen';
import { SpotRequestScreen } from '../screens/log/SpotRequestScreen';
import { navigationRef } from './navigationRef';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useSyncTimezone } from '../hooks/useSyncTimezone';
import { useAppForegroundHeartbeat } from '../hooks/useAppForegroundHeartbeat';
import { usePasswordChangeDeepLink } from '../hooks/usePasswordChangeDeepLink';

const Stack = createNativeStackNavigator<RootStackParamList>();

// The WHOOP, Spotify, and Oura connect callbacks all use this today —
// soset://whoop-callback, soset://spotify-callback, and
// soset://oura-callback (each with optional
// ?status=success|error&message=...) route straight to the Integrations
// screen. See supabase/functions/whoop-oauth-callback,
// supabase/functions/spotify-oauth-callback, and
// supabase/functions/oura-oauth-callback for the pages that send the user
// back here, and Info.plist / AndroidManifest.xml for where the `soset`
// scheme itself is registered.
//
// `alias` is how React Navigation maps additional paths to the same screen —
// a bare array isn't a valid config value here, only a string or an object
// with `path`/`alias`/`screens`.
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['soset://'],
  config: {
    screens: {
      // The Home Screen widget's "Log Food" tap target — see
      // WIDGET_LOG_FOOD_DEEP_LINK (buildWidgetPayload.ts) and ChatScreen's
      // own handling of the parsed `openFoodLog` param.
      Chat: {
        path: 'chat',
        parse: {
          openFoodLog: (value: string) => value === '1',
        },
      },
      // The welcome email's "Start your 7-Day Free Trial" CTA — see
      // supabase/functions/send-welcome-email. Paywall's own `trigger` param
      // only changes which locked-feature copy it shows, so this is safe to
      // omit or pass through from the link's own query string.
      Paywall: { path: 'paywall' },
      Profile: {
        screens: {
          Integrations: { path: 'whoop-callback', alias: ['spotify-callback', 'oura-callback'] },
        },
      },
    },
  },
};

export function RootNavigator() {
  const theme = useTheme();
  const { hydrated, isAuthenticated, onboardingCompleted, userId } = useAuthStore();
  // Once a user is authenticated and onboarded, keep the splash up a little
  // longer to warm the query cache for Today's screen — everywhere else
  // (Auth/Onboarding) this is a no-op and reports ready immediately.
  const needsBootstrap = hydrated && isAuthenticated && onboardingCompleted;
  const { ready: bootstrapped } = useAppBootstrap({ enabled: needsBootstrap, userId });
  // useAppBootstrap prefetches this under the identical ['profile', userId]
  // query key, so by the time `bootstrapped` flips true this reads straight
  // from cache — no extra request, no loading flicker before the swap below.
  const { data: profile } = useProfile(needsBootstrap ? userId : null);
  // Registers the device's push token and wires notification-tap deep
  // links once the athlete is actually signed in — a no-op (and no-op
  // cleanup) otherwise. Lives above the loading-screen early return so it
  // stays mounted for the app's whole authenticated lifetime.
  usePushNotifications(needsBootstrap ? userId : null);
  // Lets the proactive-coach cron sweep (server-side) know what "evening"
  // means for this athlete — see useSyncTimezone's own doc comment.
  useSyncTimezone(needsBootstrap ? userId : null);
  // Lets send-push's isActiveInApp check skip pushing to someone who's
  // already in the app — see useAppForegroundHeartbeat's own doc comment.
  useAppForegroundHeartbeat(needsBootstrap ? userId : null);
  // Unconditional (not gated behind needsBootstrap like the hooks above) —
  // the confirmation link this listens for is tapped from outside the app,
  // and has to work whether the athlete is currently signed in, signed out,
  // or mid-onboarding.
  usePasswordChangeDeepLink();

  // Splash always stays up for MIN_DISPLAY_DURATION_MS, regardless of how
  // fast hydration/bootstrap resolve, so its animation is always seen
  // through rather than flashing past on a fast launch.
  const [minDurationElapsed, setMinDurationElapsed] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setMinDurationElapsed(true), MIN_DISPLAY_DURATION_MS);
    return () => clearTimeout(id);
  }, []);

  if (!hydrated || (needsBootstrap && !bootstrapped) || !minDurationElapsed) {
    return profile?.is_premium ? <ProLoadingScreen /> : <LoadingScreen />;
  }

  const navTheme: NavTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: theme.colors.bg.base,
      card: theme.colors.bg.surface,
      border: theme.colors.border.default,
      primary: theme.colors.accent.primary,
      text: theme.colors.text.primary,
    },
  };

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} linking={linking}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isAuthenticated ? (
          <Stack.Screen name="Auth" component={AuthStack} />
        ) : !onboardingCompleted ? (
          <Stack.Screen name="Onboarding" component={OnboardingStack} />
        ) : (
          <>
            <Stack.Screen name="MainTabs" component={AppShell} />
            <Stack.Screen name="Profile" component={ProfileStack} />
            <Stack.Screen
              name="Chat"
              component={ChatScreen}
              // 'card' (a normal full-screen push, not a modal at all) rather
              // than the default 'modal' (an iOS page sheet) — page sheets
              // are presented in a way that can throw off
              // KeyboardAvoidingView's height math, leaving the message
              // input covered by the keyboard. 'card' avoids that the same
              // way 'fullScreenModal' used to (neither is a page sheet), but
              // unlike 'fullScreenModal' it still honors the explicit
              // `animation` below on both platforms — with a true modal
              // presentation, iOS's own modal transition controller takes
              // over and silently ignores whatever `animation` is set to,
              // which is why 'card' (not modal) is required here regardless
              // of which direction the slide comes from. `animation:
              // 'slide_from_bottom'` matches Arnold's button living in the
              // tab bar (see MainTabs/ArnoldTabButton) — chat rises from the
              // same edge that button sits on; the header's own collapse
              // chevron (see ChatScreen.tsx) reverses that motion.
              options={{ presentation: 'card', animation: 'slide_from_bottom', headerShown: false }}
            />
            <Stack.Screen name="Paywall" component={PaywallScreen} options={{ presentation: 'modal', headerShown: false }} />
            <Stack.Screen
              name="SpotRequest"
              component={SpotRequestScreen}
              // 'transparentModal' (not 'modal') so the screen underneath
              // stays visible, dimmed, behind this one — matches the
              // reviewed mockup's bottom-sheet-over-backdrop look. The
              // screen itself renders its own dim + sheet rather than
              // reusing components/core's BottomSheet, which owns its own
              // <Modal> and would double up with this one.
              options={{ presentation: 'transparentModal', animation: 'fade', headerShown: false }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
