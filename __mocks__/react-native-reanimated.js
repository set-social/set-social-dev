/**
 * Reanimated 4 (worklets-based, New Architecture only) has no working Jest
 * mock for this environment — its official mock.js still touches native
 * worklets bindings that don't exist under Jest. This is a minimal manual
 * mock covering exactly what the design system's components use (Button.tsx,
 * BottomSheet.tsx), auto-applied by Jest for any import of
 * 'react-native-reanimated'.
 */
const React = require('react');

function useSharedValue(initialValue) {
  return React.useRef({ value: initialValue }).current;
}

function useAnimatedStyle(styleFactory) {
  return styleFactory();
}

function withTiming(toValue, _config, callback) {
  // Real reanimated calls the completion callback (with `finished: true`)
  // asynchronously once the animation finishes — components like
  // BottomSheet gate real work (unmounting, an onDismissed side effect) on
  // it. Firing it synchronously here is the closest a JS-thread mock can get
  // without an actual animation clock, and is what those call sites need to
  // be exercised by tests at all.
  if (callback) callback(true);
  return toValue;
}

function withSpring(toValue) {
  return toValue;
}

function withRepeat(animation) {
  return animation;
}

function withSequence(...animations) {
  return animations[animations.length - 1];
}

function withDelay(_delayMs, animation) {
  return animation;
}

function useReducedMotion() {
  return false;
}

function useAnimatedKeyboard() {
  // Keyboard always reads as closed under Jest — nothing here drives a real
  // native keyboard-frame notification. Matches useSharedValue's `{ value }`
  // shape so `keyboard.height.value` reads in a useAnimatedStyle factory.
  return { height: { value: 0 }, state: { value: 0 } };
}

function interpolate(value, input, output) {
  return output[0];
}

function runOnJS(fn) {
  return fn;
}

function useAnimatedReaction() {
  // Real Reanimated re-runs the prepare/react pair on the UI thread whenever
  // a shared value it reads changes, entirely outside React's render cycle —
  // this mock's useSharedValue is just a plain ref with no such reactivity
  // (see its own comment above), so there's nothing to meaningfully drive a
  // reaction off of here. Screens that rely on it for actual behavior (not
  // just visual polish) need a real device/simulator to verify — see
  // ReorderableExerciseList's cross-row settle animation.
}

const Extrapolation = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' };

const Easing = {
  ease: value => value,
  inOut: fn => fn,
  linear: value => value,
  out: fn => fn,
  in: fn => fn,
  cubic: value => value,
  quad: value => value,
};

const Animated = {
  createAnimatedComponent: Component => Component,
  View: require('react-native').View,
  Text: require('react-native').Text,
  Image: require('react-native').Image,
  ScrollView: require('react-native').ScrollView,
};

module.exports = {
  __esModule: true,
  default: Animated,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withRepeat,
  withSequence,
  withDelay,
  useReducedMotion,
  useAnimatedKeyboard,
  useAnimatedReaction,
  interpolate,
  runOnJS,
  Extrapolation,
  Easing,
};
