import React, { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from '../components/core';
import { useChatUiStore } from '../store/chatUiStore';
import { TAB_BAR_CONTENT_HEIGHT, TAB_BAR_FLOAT_GAP } from './MainTabs';
import type { RootStackParamList } from './types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const LINE_WIDTH = 52;
const LINE_HEIGHT = 3;
const GLOW_SIZE = 36;
const TOUCH_ZONE_WIDTH = 72;
const TOUCH_ZONE_HEIGHT = 40;
const PULSE_LEG_MS = 1100;
const SWIPE_DISTANCE_THRESHOLD = -36;
const SWIPE_VELOCITY_THRESHOLD = -500;

/**
 * Replaces the old floating ChatFab — a hairline highlight on the tab bar's
 * own top border instead of a circle sitting on top of the screen. Drag up
 * from it, or just tap it, to open the AI coach; both hand off to the same
 * existing 'fullScreenModal' Chat screen the bubble used to open (see
 * RootNavigator) rather than tracking the drag into a custom sheet — that
 * presentation mode was deliberately chosen over a page-sheet modal to fix a
 * keyboard-avoidance bug, and a from-scratch sheet would risk reintroducing
 * it for comparatively little payoff over a plain trigger.
 *
 * The pan gesture only needs `.onEnd` (not `.onChange`) since nothing here
 * tracks the sheet visually — it's purely "did this drag clear the
 * threshold," same as the FAB's onPress was purely "was this tapped."
 * Wrapping a plain `Pressable` in the `GestureDetector` (rather than a
 * second `Gesture.Tap()`) keeps normal-tap accessibility (VoiceOver/
 * TalkBack activation) working for free — Pan's own default move threshold
 * already ignores a stationary tap, so the two don't compete.
 */
export function ChatEdgeTab() {
  const theme = useTheme();
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const hasUnread = useChatUiStore(state => state.hasUnread);
  const reducedMotion = useReducedMotion();

  const pulse = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      // Static, resting value — no breathing glow.
      pulse.value = 0.5;
      return;
    }
    pulse.value = withRepeat(
      withTiming(1, { duration: PULSE_LEG_MS, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [reducedMotion, pulse]);

  const openChat = () => navigation.navigate('Chat', undefined);

  const panGesture = Gesture.Pan().onEnd(event => {
    if (event.translationY < SWIPE_DISTANCE_THRESHOLD || event.velocityY < SWIPE_VELOCITY_THRESHOLD) {
      runOnJS(openChat)();
    }
  });

  const arrowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.5, 1]),
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0, 0.7]),
  }));

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: TAB_BAR_CONTENT_HEIGHT + insets.bottom + TAB_BAR_FLOAT_GAP,
        alignItems: 'center',
      }}
    >
      <GestureDetector gesture={panGesture}>
        <Pressable
          onPress={openChat}
          accessibilityRole="button"
          accessibilityLabel="Chat with Arnold"
          accessibilityHint="Opens the chat. You can also drag up from here."
          style={({ pressed }) => [
            {
              width: TOUCH_ZONE_WIDTH,
              height: TOUCH_ZONE_HEIGHT,
              alignItems: 'center',
              justifyContent: 'flex-end',
            },
            pressed ? { opacity: 0.7 } : null,
          ]}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                bottom: -4,
                left: (TOUCH_ZONE_WIDTH - GLOW_SIZE) / 2,
                width: GLOW_SIZE,
                height: GLOW_SIZE,
              },
              glowStyle,
            ]}
          >
            <Svg width={GLOW_SIZE} height={GLOW_SIZE} viewBox="0 0 100 100">
              <Defs>
                <RadialGradient id="dragGlow" cx="50%" cy="50%" r="50%">
                  <Stop offset="0%" stopColor={theme.colors.accent.primary} stopOpacity={0.55} />
                  <Stop offset="55%" stopColor={theme.colors.accent.primary} stopOpacity={0.18} />
                  <Stop offset="100%" stopColor={theme.colors.accent.primary} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Circle cx={50} cy={50} r={50} fill="url(#dragGlow)" />
            </Svg>
          </Animated.View>

          <Animated.View style={[{ marginBottom: 6 }, arrowStyle]} pointerEvents="none">
            <Icon name="chevronUp" size={12} color={theme.colors.accent.primary} strokeWidth={1.75} />
          </Animated.View>

          <View
            testID="chat-drag-line"
            pointerEvents="none"
            style={{
              width: LINE_WIDTH,
              height: LINE_HEIGHT,
              borderRadius: theme.radii.pill,
              backgroundColor: theme.colors.accent.primary,
              opacity: hasUnread ? 1 : 0.55,
            }}
          />
        </Pressable>
      </GestureDetector>
    </View>
  );
}
