import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  type KeyboardAvoidingViewProps,
} from 'react-native';

type KeyboardAvoiderProps = Omit<KeyboardAvoidingViewProps, 'behavior'>;

/**
 * Drop-in replacement for RN's KeyboardAvoidingView. `behavior={undefined}`
 * on Android (the value screens used to pass, relying on the manifest's
 * windowSoftInputMode="adjustResize" to do the work instead) doesn't reach
 * content inside react-native-screens' native-stack Fragments or a Modal
 * window (BottomSheet) — the keyboard covers whatever's focused. 'height'
 * fixes both. Always use this instead of importing KeyboardAvoidingView
 * directly (see the no-restricted-imports rule in .eslintrc.js).
 */
export function KeyboardAvoider({ style, ...props }: KeyboardAvoiderProps) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={style ?? { flex: 1 }}
      {...props}
    />
  );
}
