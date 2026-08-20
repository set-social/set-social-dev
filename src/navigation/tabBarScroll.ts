import { Animated, Easing } from 'react-native';
import type { NativeSyntheticEvent, NativeScrollEvent } from 'react-native';

/**
 * 0 = the floating tab bar is fully expanded/visible, 1 = fully collapsed
 * (shrunk + faded). A module-level `Animated.Value` (React Native's core
 * Animated API, not Reanimated) rather than React Context — every screen
 * that scrolls under the bar lives several navigator layers away from
 * MainTabs (TodayStack/ProgramsStack/etc., each nested under
 * Tab.Navigator), so a Context provider would have to wrap the whole app
 * to reach both sides. A plain exported `Animated.Value` is a ref any file
 * can import and read (MainTabs' animated wrapper) or write (a screen's
 * scroll handler) directly, with no provider and no re-renders. (Reanimated's
 * equivalent, `makeMutable`, isn't usable here — it isn't backed by a
 * JS-only fallback under Jest, which broke every test that imports
 * MainTabs transitively; RN's own Animated.Value has no such gap.)
 */
export const tabBarCollapse = new Animated.Value(0);

// Guessed — not sourced from any existing token, tuned by eye for "reacts
// to a real scroll, ignores rubber-band/momentum jitter near the edges."
const COLLAPSE_THRESHOLD = 12;
const TOP_RESTORE_OFFSET = 8;
const ANIMATION_DURATION = 220;
const STOPPED_RESTORE_DELAY = 650;

let lastY = 0;
let collapsed = false;
let restoreTimer: ReturnType<typeof setTimeout> | null = null;

function expand() {
  collapsed = false;
  Animated.timing(tabBarCollapse, {
    toValue: 0,
    duration: ANIMATION_DURATION,
    easing: Easing.out(Easing.cubic),
    useNativeDriver: true,
  }).start();
}

function collapse() {
  collapsed = true;
  Animated.timing(tabBarCollapse, {
    toValue: 1,
    duration: ANIMATION_DURATION,
    easing: Easing.out(Easing.cubic),
    useNativeDriver: true,
  }).start();
}

/**
 * Plug the returned `onScroll` into any ScrollView/FlatList that renders
 * under the floating tab bar (with `scrollEventThrottle` set, e.g. 16) to
 * drive its shared collapse animation — scrolling down past the threshold
 * shrinks/fades the bar, scrolling up or reaching the top restores it, and
 * a debounce restores it automatically shortly after scrolling stops so it
 * can never get stuck in the shrunk state.
 *
 * `collapsed` gates the actual `expand()`/`collapse()` calls to a single
 * transition each way — `onScroll` fires on every frame of a drag (dozens
 * of times per gesture), so without this guard the qualifying condition
 * stays true for many consecutive events and keeps restarting the same
 * `Animated.timing` from scratch each time, which reads as a jittery,
 * multi-step scale instead of one clean animation in each direction.
 */
export function useTabBarScrollHandler() {
  return {
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const delta = y - lastY;
      lastY = y;

      if (restoreTimer) {
        clearTimeout(restoreTimer);
        restoreTimer = null;
      }

      if (collapsed && (y <= TOP_RESTORE_OFFSET || delta < -COLLAPSE_THRESHOLD)) {
        expand();
      } else if (!collapsed && delta > COLLAPSE_THRESHOLD) {
        collapse();
      }

      // Only need a "stopped scrolling" safety net while actually collapsed
      // — nothing to restore otherwise, so don't reschedule for no reason.
      if (collapsed) {
        restoreTimer = setTimeout(expand, STOPPED_RESTORE_DELAY);
      }
    },
  };
}

/** Restores the bar immediately — called on tab focus so switching tabs
 * never lands on a screen with the bar still shrunk from wherever the
 * previous tab had scrolled to. */
export function expandTabBarOnFocus() {
  lastY = 0;
  if (restoreTimer) {
    clearTimeout(restoreTimer);
    restoreTimer = null;
  }
  expand();
}
