import React, { useEffect } from 'react';
import { Animated as RNAnimated, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import LinearGradient from 'react-native-linear-gradient';
import { BlurView } from '@react-native-community/blur';
import { BottomTabBar, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  CommonActions,
  getFocusedRouteNameFromRoute,
  useNavigation,
  type NavigationState,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MainTabParamList, RootStackParamList } from './types';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, Badge, type IconName } from '../components/core';
import { useAuthStore } from '../store/authStore';
import { useProfile } from '../services/api/queries/profiles';
import { useNotificationBadges } from '../services/api/queries/notifications';
import { useChatUiStore } from '../store/chatUiStore';
import { useActiveWorkoutStore } from '../store/activeWorkoutStore';
import { ArnoldTabButton } from './ArnoldTabButton';
import { expandTabBarOnFocus, tabBarCollapse } from './tabBarScroll';
import { TAB_ICON_SIZE } from './tabBarConstants';
import { TodayStack } from './TodayStack';
import { ProgramsStack } from './ProgramsStack';
import { ProgressStack } from './ProgressStack';
import { CommunityStack } from './CommunityStack';

const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_ICONS: Record<Exclude<keyof MainTabParamList, 'ArnoldTab'>, IconName> = {
  TodayTab: 'home',
  ProgramsTab: 'calendar',
  ProgressTab: 'trendingUp',
  CommunityTab: 'messageCircle',
};

const TAB_ICON_FOCUSED_SCALE = 1.18;

/** Pops the icon up in size on the frame it becomes focused, and back down
 * when it isn't — a spring rather than a timing curve so the "landing" has
 * a little overshoot instead of just easing to a stop. */
function AnimatedTabIcon({
  name,
  color,
  focused,
}: {
  name: IconName;
  color: string;
  focused: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(focused ? TAB_ICON_FOCUSED_SCALE : 1);

  useEffect(() => {
    const target = focused ? TAB_ICON_FOCUSED_SCALE : 1;
    if (reducedMotion) {
      scale.value = target;
      return;
    }
    scale.value = withSpring(target, { damping: 10, stiffness: 260, mass: 0.6 });
  }, [focused, reducedMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Icon
        name={name}
        size={TAB_ICON_SIZE}
        color={color}
        strokeWidth={focused ? 2.25 : 1.75}
      />
    </Animated.View>
  );
}

// Guessed — no existing token for "how much smaller/dimmer while scrolling,"
// tuned by eye for "less obtrusive" without reading as broken/half-hidden.
const SCROLL_COLLAPSE_SCALE = 0.92;
const SCROLL_COLLAPSE_OPACITY = 0.85;

/**
 * Wraps the default `BottomTabBar` render so the whole bar — glass pill,
 * icons, and labels together, not just the background layer — can shrink
 * and fade as one unit while the active screen scrolls. `tabBarStyle` is
 * applied to a plain View inside `BottomTabBar` itself, so it can't be
 * driven by a shared value directly; wrapping the entire default renderer
 * in one Animated.View here, via the `tabBar` prop instead of just
 * `tabBarBackground`, is what lets one shared value (`tabBarCollapse`,
 * written to by any screen's `useTabBarScrollHandler`) move everything
 * together. `{...props}` is passed straight through to `BottomTabBar`
 * unchanged, so every existing option (background pill, per-tab icons,
 * ArnoldTabButton, badges) renders exactly as before this wrapper existed.
 *
 * Uses React Native's own Animated API rather than Reanimated for just this
 * shared value — Reanimated's module-level equivalent (`makeMutable`) isn't
 * usable under this project's Jest setup (see tabBarScroll.ts), and RN's
 * Animated.Value is just as capable for a plain scale+opacity tween.
 */
function AnimatedTabBarShell(props: React.ComponentProps<typeof BottomTabBar>) {
  const reducedMotion = useReducedMotion();

  const scale = reducedMotion
    ? 1
    : tabBarCollapse.interpolate({ inputRange: [0, 1], outputRange: [1, SCROLL_COLLAPSE_SCALE] });
  const opacity = reducedMotion
    ? 1
    : tabBarCollapse.interpolate({ inputRange: [0, 1], outputRange: [1, SCROLL_COLLAPSE_OPACITY] });

  return (
    <RNAnimated.View
      style={[{ position: 'absolute', left: 0, right: 0, bottom: 0 }, { transform: [{ scale }], opacity }]}
    >
      <BottomTabBar {...props} />
    </RNAnimated.View>
  );
}

/** Content height of the tab bar excluding the bottom safe-area inset —
 * the actual on-screen height is this plus `insets.bottom`. Exported so
 * PostFab can sit a consistent distance above (or flush against) the bar
 * on every device instead of using a magic-number offset that only
 * happened to clear it on some screen sizes. */
export const TAB_BAR_CONTENT_HEIGHT = 56;

/** Empty space above and below the floating glass pill (screen edge → pill
 * top, and pill bottom → the safe-area inset) — kept equal to
 * `TAB_BAR_INSET` so the pill floats with a symmetric margin on all four
 * edges rather than a tall, uneven gap at the bottom. Exported so PostFab/
 * ChatEdgeTab, which sit above the tab bar rather than inside its
 * navigator, can still land flush against the pill's actual top edge
 * instead of the old flush-bottom bar's. */
export const TAB_BAR_FLOAT_GAP = 16;

const TAB_BAR_INSET = 16;
const TAB_BAR_RADIUS = 28;

/**
 * Total footprint of the floating bar, measured from the very bottom of the
 * screen — now that it's a `position: 'absolute'` overlay (see tabBarStyle
 * below) rather than a normal-flow sibling, screens no longer get this
 * space reserved for them automatically. Every scrollable screen inside
 * TodayStack/ProgramsStack/ProgressStack/CommunityStack should add this as
 * `contentContainerStyle` bottom padding (not an outer View's padding —
 * that would just re-clip the scroll area and defeat the point of content
 * sliding under the glass) so its last item can clear the bar and the
 * pill's blur has real content to show through as the user scrolls.
 */
export function useFloatingTabBarHeight() {
  const insets = useSafeAreaInsets();
  return TAB_BAR_CONTENT_HEIGHT + TAB_BAR_FLOAT_GAP * 2 + insets.bottom;
}

/** Same footprint, without `insets.bottom` — for a fixed (non-scrolling)
 * footer inside a `SafeAreaView` that already has its default (all-edge)
 * safe-area padding, so the safe-area bottom inset isn't added twice. */
export const TAB_BAR_FLOAT_FOOTPRINT = TAB_BAR_CONTENT_HEIGHT + TAB_BAR_FLOAT_GAP * 2;

/** ArnoldTab's registered screen component — never actually rendered, see
 * MainTabParamList's own doc comment on ArnoldTab. */
function ArnoldPlaceholderScreen() {
  return null;
}

/**
 * Clears a tab's own nested stack state on blur, so switching away and back
 * always lands on that tab's root screen instead of resuming wherever the
 * athlete happened to leave it (e.g. Training resuming on a day's detail
 * screen, or several screens deep in Library, rather than the week list).
 * Standard React Navigation pattern for this: set that specific route's
 * `state` to `undefined`, which forces its nested navigator to reinitialize
 * from its own initialRouteName the next time it's focused — the state
 * itself, not a fresh mount, is what's reset. See React Navigation's own
 * "Resetting a nested stack" guide.
 */
type MinimalTabState = { routes: Array<{ key: string; [extra: string]: unknown }> };

export function resetNestedStackOnBlur(
  routeKey: string,
  navigation: { dispatch: (action: (state: MinimalTabState) => ReturnType<typeof CommonActions.reset>) => void },
): void {
  navigation.dispatch(state => {
    const routes = state.routes.map(r => (r.key === routeKey ? { ...r, state: undefined } : r));
    return CommonActions.reset({ ...state, routes } as unknown as NavigationState);
  });
}

type MainTabsProps = {
  /** Fires with the newly-focused tab's route name, and the name of whatever
   * screen is focused within that tab's own nested stack (e.g. 'Posts',
   * 'Conversation'), on every navigation change — lets AppShell decide which
   * FAB to show (nowhere except the Social tab's own feed, which gets its
   * own "new post" FAB; every other Social-tab screen gets neither) without
   * this navigator needing to know anything about FABs itself. */
  onActiveTabChange?: (tabName: keyof MainTabParamList, focusedScreenName?: string) => void;
};

export function MainTabs({ onActiveTabChange }: MainTabsProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore(state => state.userId);
  const { data: profile } = useProfile(userId);
  const { hasAny: hasSocialNotification } = useNotificationBadges(userId, {
    messagesSeenAt: profile?.messages_seen_at,
    activitySeenAt: profile?.activity_seen_at,
  });
  const hasUnreadChat = useChatUiStore(state => state.hasUnread);
  // Resolves to the root stack navigator — MainTabs is rendered directly as
  // a RootStack screen (via AppShell), one level above this Tab.Navigator,
  // so useNavigation() called here (rather than inside a Tab.Screen's own
  // subtree) grabs that parent instead of the tab navigator itself. Needed
  // because Chat is a root-level screen, not nested under any one tab.
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <Tab.Navigator
      screenListeners={{
        state: e => {
          const state = e.data.state as
            | { routes: { name: string; state?: unknown; params?: unknown }[]; index: number }
            | undefined;
          const activeTabRoute = state?.routes[state.index];
          if (!activeTabRoute) return;
          const focusedScreenName = getFocusedRouteNameFromRoute(
            activeTabRoute as Parameters<typeof getFocusedRouteNameFromRoute>[0],
          );
          onActiveTabChange?.(activeTabRoute.name as keyof MainTabParamList, focusedScreenName);
          // Never land on a freshly-focused tab with the bar still shrunk
          // from wherever the previous tab had scrolled to.
          expandTabBarOnFocus();
        },
      }}
      tabBar={props => <AnimatedTabBarShell {...props} />}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent.primary,
        tabBarInactiveTintColor: theme.colors.text.primary,
        tabBarItemStyle: { justifyContent: 'center' },
        tabBarStyle: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
          height: TAB_BAR_CONTENT_HEIGHT + TAB_BAR_FLOAT_GAP * 2 + insets.bottom,
          paddingTop: TAB_BAR_FLOAT_GAP,
          paddingBottom: insets.bottom + TAB_BAR_FLOAT_GAP,
          paddingHorizontal: TAB_BAR_INSET,
        },
        // Renders behind the tab buttons, sized to the tabBarStyle box above
        // — inset further here to leave the transparent gap that makes the
        // bar read as a floating pill rather than a flat strip. Real blur on
        // Android needs `overlayColor` (an opaque tint the library composites
        // the blur into) or it silently renders as a flat color; iOS ignores
        // it and blurs whatever's actually behind the view.
        tabBarBackground: () => (
          <View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                left: TAB_BAR_INSET,
                right: TAB_BAR_INSET,
                top: TAB_BAR_FLOAT_GAP,
                bottom: insets.bottom + TAB_BAR_FLOAT_GAP,
                borderRadius: TAB_BAR_RADIUS,
                // Deeper than theme.shadows.lg on purpose — this is the one
                // element that has to visually separate from whatever's
                // scrolling underneath it, not just lift off a flat surface.
                shadowColor: '#000000',
                shadowOffset: { width: 0, height: 10 },
                shadowOpacity: theme.colorScheme === 'dark' ? 0.45 : 0.22,
                shadowRadius: 22,
                elevation: 14,
              },
            ]}
          >
            <View
              style={{
                flex: 1,
                borderRadius: TAB_BAR_RADIUS,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor:
                  theme.colorScheme === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.8)',
              }}
            >
              <BlurView
                style={StyleSheet.absoluteFill}
                blurType={theme.colorScheme === 'dark' ? 'dark' : 'xlight'}
                blurAmount={28}
                reducedTransparencyFallbackColor={theme.colors.bg.surface}
                overlayColor={
                  theme.colorScheme === 'dark' ? 'rgba(23,27,35,0.58)' : 'rgba(255,255,255,0.58)'
                }
              />
              {/* Soft sheen instead of a hard rim — a per-edge border color
                  looks like a seam at the rounded corners, this is the clean
                  way to hint "light catching glass": a gradient wash, not a
                  line. */}
              <LinearGradient
                pointerEvents="none"
                colors={
                  theme.colorScheme === 'dark'
                    ? ['rgba(255,255,255,0.14)', 'rgba(255,255,255,0)']
                    : ['rgba(255,255,255,0.65)', 'rgba(255,255,255,0)']
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            </View>
          </View>
        ),
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' as const, marginTop: 2 },
        tabBarIcon: ({ color, focused }) => (
          <View>
            <AnimatedTabIcon
              name={TAB_ICONS[route.name as Exclude<keyof MainTabParamList, 'ArnoldTab'>]}
              color={color}
              focused={focused}
            />
            {route.name === 'CommunityTab' ? <Badge visible={hasSocialNotification} /> : null}
          </View>
        ),
      })}
    >
      <Tab.Screen
        name="TodayTab"
        component={TodayStack}
        options={{ tabBarLabel: 'Today' }}
        listeners={({ navigation, route }) => ({
          blur: () => resetNestedStackOnBlur(route.key, navigation),
        })}
      />
      <Tab.Screen
        name="ProgramsTab"
        component={ProgramsStack}
        options={{ tabBarLabel: 'Training' }}
        listeners={({ navigation, route }) => ({
          // Skipped mid-workout — losing your exact place in an in-progress
          // lift (which set/exercise screen you were on) just because you
          // glanced at another tab would be a real disruption, not a
          // convenience. The workout itself would survive regardless (it's
          // persisted in activeWorkoutStore, not navigation state) — this
          // guard is purely about not discarding *where in it* you were.
          blur: () => {
            if (useActiveWorkoutStore.getState().workoutLogId != null) return;
            resetNestedStackOnBlur(route.key, navigation);
          },
        })}
      />
      <Tab.Screen
        name="ArnoldTab"
        component={ArnoldPlaceholderScreen}
        options={{
          tabBarButton: props => (
            <ArnoldTabButton onPress={props.onPress} hasUnread={hasUnreadChat} />
          ),
        }}
        listeners={{
          tabPress: e => {
            // Always redirect to the root Chat screen instead of ever
            // actually focusing this tab — see MainTabParamList's own doc
            // comment on ArnoldTab for why this route exists at all.
            e.preventDefault();
            rootNavigation.navigate('Chat', undefined);
          },
        }}
      />
      <Tab.Screen
        name="ProgressTab"
        component={ProgressStack}
        options={{ tabBarLabel: 'Stats' }}
        listeners={({ navigation, route }) => ({
          blur: () => resetNestedStackOnBlur(route.key, navigation),
        })}
      />
      <Tab.Screen
        name="CommunityTab"
        component={CommunityStack}
        options={{ tabBarLabel: 'Social' }}
        listeners={({ navigation, route }) => ({
          blur: () => resetNestedStackOnBlur(route.key, navigation),
        })}
      />
    </Tab.Navigator>
  );
}
