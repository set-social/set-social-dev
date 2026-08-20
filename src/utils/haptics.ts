import ReactNativeHapticFeedback, {
  type HapticFeedbackTypes,
} from 'react-native-haptic-feedback';

// iOS ignores the system's "reduce motion"/haptics-off switch on its own —
// respecting it here is the app's job, same as any other haptic call site
// would need to. android:enableVibrateFallback lets phones with no real
// haptic engine still buzz via the plain vibrator, so this one call covers
// both platforms without a per-call Platform.OS branch.
const OPTIONS = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: false,
};

export function triggerHaptic(
  type: keyof typeof HapticFeedbackTypes | HapticFeedbackTypes = 'impactMedium',
) {
  ReactNativeHapticFeedback.trigger(type, OPTIONS);
}
