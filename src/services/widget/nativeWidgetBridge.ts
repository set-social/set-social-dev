import { NativeModules, Platform } from 'react-native';
import type { WidgetPayload } from './types';

type WidgetBridgeNativeModule = {
  setPayload(json: string): Promise<null>;
  reloadWidgets(): void;
};

const nativeModule = NativeModules.WidgetBridge as WidgetBridgeNativeModule | undefined;

/**
 * Fire-and-forget by design — nothing in the app should ever wait on the
 * widget refreshing. Safe to call unconditionally from day one: both native
 * sides expose the same `WidgetBridge` module name (ios/GymBee/WidgetBridge,
 * android/.../WidgetBridgeModule), so this one call updates whichever Home
 * Screen widget the athlete actually has — and it's a no-op everywhere else
 * (web, or either platform before its native module is wired into the
 * build) rather than throwing on an unlinked native module.
 */
export function syncWidget(payload: WidgetPayload): void {
  if ((Platform.OS !== 'ios' && Platform.OS !== 'android') || !nativeModule) return;
  nativeModule.setPayload(JSON.stringify(payload)).then(
    () => nativeModule.reloadWidgets(),
    () => {
      // A malformed payload rejects setPayload on the native side — nothing
      // to recover here; the next successful sync overwrites it.
    },
  );
}
