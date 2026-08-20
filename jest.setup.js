/* eslint-env jest */
require('react-native-gesture-handler/jestSetup');

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest'),
);

// The real SafeAreaProvider measures insets from a native host view, which
// doesn't exist under the test renderer — useSafeAreaInsets() (now pulled in
// by MainTabs' useFloatingTabBarHeight, used across most screens for the
// floating glass tab bar's clearance) throws "No safe area value available"
// without this, even for screens that render no SafeAreaProvider themselves.
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

// Destructures NativeModules.CreateThumbnail.create at import time (see
// node_modules/react-native-create-thumbnail/index.js) rather than lazily
// inside a function call the way react-native-image-picker does, so it
// throws immediately under Jest's stubbed NativeModules unless mocked here.
jest.mock('react-native-create-thumbnail', () => ({
  createThumbnail: jest.fn(),
}));

// RN's real <Modal> renders through a native host component (RCTModalHostView)
// that only exists as an inert node under the test renderer — there's no real
// native bridge to fire its `onDismiss` back, the callback BottomSheet.tsx
// relies on (iOS only) to know the native dismiss has actually finished
// before it's safe to present another modal (e.g. an image picker) on top.
// This mock simulates that completion once `visible` flips true -> false, the
// same way a real device does once BottomSheet's own close animation ends.
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const React = require('react');
  function MockModal({ visible, onShow, onDismiss, children }) {
    const wasVisible = React.useRef(visible);
    React.useEffect(() => {
      if (visible && !wasVisible.current && onShow) onShow();
      if (!visible && wasVisible.current && onDismiss) onDismiss();
      wasVisible.current = visible;
    }, [visible, onShow, onDismiss]);
    if (!visible) return null;
    return React.createElement(React.Fragment, null, children);
  }
  return { __esModule: true, default: MockModal };
});
