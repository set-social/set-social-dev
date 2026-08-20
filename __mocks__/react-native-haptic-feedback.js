/**
 * The real module resolves to a native TurboModule (HapticFeedback.trigger
 * etc. — see NativeHapticFeedback.ts) that doesn't exist under the test
 * renderer; even Jest's own automock support crashes here because building
 * an automock still requires loading the real module first to inspect its
 * shape. Manual stub instead, auto-applied by Jest for any import of
 * 'react-native-haptic-feedback' (same convention as this repo's
 * react-native-reanimated mock).
 */
const trigger = jest.fn();
const stop = jest.fn();
const isSupported = jest.fn(() => true);
const triggerPattern = jest.fn();
const impact = jest.fn();
const playAHAP = jest.fn(() => Promise.resolve());
const getSystemHapticStatus = jest.fn(() => Promise.resolve({ vibrationEnabled: true, ringerMode: null }));
const setEnabled = jest.fn();
const isEnabled = jest.fn(() => true);

const RNHapticFeedback = {
  trigger,
  stop,
  isSupported,
  triggerPattern,
  impact,
  playAHAP,
  getSystemHapticStatus,
  setEnabled,
  isEnabled,
};

module.exports = {
  __esModule: true,
  default: RNHapticFeedback,
  trigger,
  stop,
  isSupported,
  triggerPattern,
  impact,
  playAHAP,
  getSystemHapticStatus,
  setEnabled,
  isEnabled,
};
