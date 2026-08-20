import React, { useEffect, useState } from 'react';
import {
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from './Text';
import { KeyboardAvoider } from './KeyboardAvoider';

const SHEET_MAX_HEIGHT = Dimensions.get('window').height * 0.8;
const DISMISS_DISTANCE_RATIO = 0.3;
const DISMISS_VELOCITY = 800;

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Fires once the close animation actually finishes and the sheet has
   * unmounted — not when `onClose`/`visible=false` is first requested. Use
   * this (not `onClose`) to sequence anything that itself presents a native
   * modal (an image picker, another BottomSheet, an Alert on some Android
   * versions) — the sheet's own Modal stays mounted for the ~200ms close
   * animation, and presenting on top of a still-dismissing native modal is a
   * real iOS crash (RN's Modal and an imperative UIViewController
   * presentation, like react-native-image-picker's camera, fighting over
   * the same presentation slot), not just a visual glitch. */
  onDismissed?: () => void;
  title?: string;
  children: React.ReactNode;
};

/**
 * Modal-based bottom sheet used for selection flows across the app (add-to-day,
 * library card overflow menu, per-exercise metric picker). Controlled via a
 * plain `visible` boolean — stays mounted through its own close animation,
 * then unmounts, rather than disappearing the instant the caller flips the prop.
 */
export function BottomSheet({
  visible,
  onClose,
  onDismissed,
  title,
  children,
}: BottomSheetProps) {
  const theme = useTheme();
  // Sheets are short forms — a caller whose last field is a multiline
  // input right above its own Save/submit button (FriendProfileScreen's
  // "Edit Bio", ReportBlockSheet's reason field, etc.) hits the same "no
  // scroll room left to clear the keyboard" issue full screens do, and
  // every caller would otherwise have to know to add this spacer itself.
  // Handled once here instead, the same fix WorkoutSummaryScreen/
  // PreWorkoutReviewScreen/ActiveExerciseScreen apply for their own
  // trailing Notes fields.
  const keyboard = useAnimatedKeyboard();
  const keyboardSpacerStyle = useAnimatedStyle(() => ({
    height: keyboard.height.value,
  }));
  const translateY = useSharedValue(SHEET_MAX_HEIGHT);
  const [rendered, setRendered] = useState(visible);
  // iOS only: once our own slide-down finishes, we stop asking the native
  // <Modal> to show itself but keep this component mounted a beat longer —
  // its `onDismiss` (below) fires only once iOS has actually torn down the
  // presentation, which is the one reliable signal that it's safe to present
  // another native modal (an image picker) on top. Unmounting immediately
  // instead (what this used to do, and what Android still does — RN's
  // `onDismiss` is a no-op there) races that teardown: the picker can get
  // presented on a view controller that's still mid-dismissal and iOS drops
  // it silently, no error, no callback. See `onDismissed` below.
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (visible) {
      setClosing(false);
      setRendered(true);
      // Near-critically-damped and stiff: rises fast with essentially no
      // overshoot/wobble, instead of the slower, bouncier settle the old
      // (lower stiffness, more underdamped) config produced.
      translateY.value = withSpring(0, {
        damping: 40,
        stiffness: 400,
        mass: 0.9,
      });
    } else if (rendered) {
      translateY.value = withTiming(
        SHEET_MAX_HEIGHT,
        { duration: 200 },
        finished => {
          if (finished) {
            if (Platform.OS === 'ios') {
              runOnJS(setClosing)(true);
            } else {
              runOnJS(setRendered)(false);
              if (onDismissed) runOnJS(onDismissed)();
            }
          }
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pan = Gesture.Pan()
    .onChange(event => {
      translateY.value = Math.max(0, translateY.value + event.changeY);
    })
    .onEnd(event => {
      const shouldDismiss =
        translateY.value > SHEET_MAX_HEIGHT * DISMISS_DISTANCE_RATIO ||
        event.velocityY > DISMISS_VELOCITY;
      if (shouldDismiss) {
        runOnJS(onClose)();
      } else {
        translateY.value = withSpring(0, {
          damping: 40,
          stiffness: 400,
          mass: 0.9,
        });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateY.value,
      [0, SHEET_MAX_HEIGHT],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }));

  if (!rendered) return null;

  return (
    <Modal
      visible={Platform.OS === 'ios' ? !closing : rendered}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={onClose}
      onDismiss={
        Platform.OS === 'ios'
          ? () => {
              setClosing(false);
              setRendered(false);
              if (onDismissed) onDismissed();
            }
          : undefined
      }
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoider style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: 'rgba(0,0,0,0.5)' },
                backdropStyle,
              ]}
            />
          </Pressable>

          <GestureDetector gesture={pan}>
            <Animated.View
              style={[
                {
                  maxHeight: SHEET_MAX_HEIGHT,
                  backgroundColor: theme.colors.bg.surfaceElevated,
                  borderTopLeftRadius: theme.radii.xl,
                  borderTopRightRadius: theme.radii.xl,
                },
                theme.shadows.lg,
                sheetStyle,
              ]}
            >
              <SafeAreaView edges={['bottom']}>
                <View
                  style={{
                    width: 36,
                    height: 4,
                    borderRadius: theme.radii.pill,
                    backgroundColor: theme.colors.border.default,
                    alignSelf: 'center',
                    marginTop: theme.spacing.sm,
                  }}
                />
                {title ? (
                  <Text
                    variant="subtitle"
                    style={{
                      textAlign: 'center',
                      marginTop: theme.spacing.sm,
                      marginHorizontal: theme.spacing.lg,
                    }}
                  >
                    {title}
                  </Text>
                ) : null}
                <ScrollView
                  contentContainerStyle={{ padding: theme.spacing.lg }}
                  showsVerticalScrollIndicator={false}
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                >
                  {children}
                  <Animated.View style={keyboardSpacerStyle} />
                </ScrollView>
              </SafeAreaView>
            </Animated.View>
          </GestureDetector>
        </KeyboardAvoider>
      </GestureHandlerRootView>
    </Modal>
  );
}
