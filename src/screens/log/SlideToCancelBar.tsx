import React, { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Icon } from '../../components/core';

const HANDLE_SIZE = 48;
const TRACK_PADDING = 4;
/** Fraction of the available travel distance the handle must clear before
 * releasing counts as a confirmed cancel rather than an aborted drag. */
const CONFIRM_THRESHOLD = 0.75;

type SlideToCancelBarProps = {
  onCancel: () => void;
  label?: string;
};

/**
 * Requires a deliberate horizontal drag, not a tap, before canceling an
 * in-progress run — replaces an instant-tap X button, which was both too
 * easy to hit by accident mid-run and (before this fix) sat right where the
 * floating tab bar's touch area overlaps the top of the screen.
 *
 * The slide itself is the confirmation, same reasoning as iOS's own "slide
 * to power off": a drag this deliberate doesn't need a second modal
 * interruption stacked on top of it, and it's much harder to trigger by
 * accident than a single tap. `onCancel` is called directly on a confirmed
 * slide — no follow-up Alert.
 */
export function SlideToCancelBar({ onCancel, label = 'Slide to cancel run' }: SlideToCancelBarProps) {
  const theme = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const translateX = useSharedValue(0);
  const maxTravel = Math.max(0, trackWidth - HANDLE_SIZE - TRACK_PADDING * 2);

  const onLayout = (event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width);

  const panGesture = Gesture.Pan()
    .onChange(event => {
      const next = translateX.value + event.changeX;
      translateX.value = Math.min(Math.max(next, 0), maxTravel);
    })
    .onEnd(() => {
      if (maxTravel > 0 && translateX.value >= maxTravel * CONFIRM_THRESHOLD) {
        translateX.value = withSpring(maxTravel);
        runOnJS(onCancel)();
      } else {
        translateX.value = withSpring(0);
      }
    });

  const handleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: maxTravel > 0 ? 1 - Math.min(1, translateX.value / (maxTravel * CONFIRM_THRESHOLD)) : 1,
  }));

  return (
    <View
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityLabel="Cancel run"
      accessibilityHint="Swipe right, or double tap, to cancel this run"
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={() => onCancel()}
      style={{
        height: HANDLE_SIZE + TRACK_PADDING * 2,
        borderRadius: theme.radii.pill,
        backgroundColor: theme.colors.bg.surface,
        borderWidth: 1,
        borderColor: theme.colors.border.subtle,
        justifyContent: 'center',
        padding: TRACK_PADDING,
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', left: 0, right: 0, alignItems: 'center' }, labelStyle]}
      >
        <Text variant="caption" color="secondary">
          {label}
        </Text>
      </Animated.View>
      <GestureDetector gesture={panGesture}>
        <Animated.View
          style={[
            {
              width: HANDLE_SIZE,
              height: HANDLE_SIZE,
              borderRadius: theme.radii.pill,
              backgroundColor: theme.colors.semantic.danger,
              alignItems: 'center',
              justifyContent: 'center',
            },
            handleStyle,
          ]}
        >
          <Icon name="x" size="sm" color={theme.colors.text.onAccent} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
