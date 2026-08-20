import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { supabase } from '../api/supabaseClient';

type AuthorizationStatus = 'authorized' | 'denied' | 'provisional' | 'ephemeral' | 'notDetermined';

type PushNotificationsNativeModule = {
  requestPermission(): Promise<boolean>;
  getAuthorizationStatus(): Promise<AuthorizationStatus>;
  getInitialNotification(): Promise<Record<string, unknown> | null>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

const nativeModule = NativeModules.PushNotificationsModule as PushNotificationsNativeModule | undefined;
const isSupported = nativeModule != null;

/** Undefined before the native module is linked (e.g. an old build without
 * it yet) — every export below no-ops (or resolves a harmless default)
 * rather than throwing, same convention as nativeWidgetBridge. Backed by
 * PushNotificationsModule.swift on iOS (APNs) and PushNotificationsModule.kt
 * on Android (FCM) — same JS-facing contract on both. */
export const pushEvents = isSupported ? new NativeEventEmitter(NativeModules.PushNotificationsModule) : null;

/** The push notification payload's `screen`/`params` — matches the shape
 * send-push builds for every notification type (see the Edge Function). */
export type PushNotificationPayload = {
  screen: string;
  params?: Record<string, unknown>;
};

/** FCM's `data` payload can only carry flat strings (see send-push's
 * `sendFcm`), so Android delivers `params` JSON-stringified — APNs delivers
 * the full payload dict as-is, so iOS's `params` already arrives as a
 * nested object. Normalizing both shapes here, in the one function both
 * platforms' events funnel through, keeps every native module trivial. */
function parsePayload(userInfo: Record<string, unknown> | null | undefined): PushNotificationPayload | null {
  if (!userInfo || typeof userInfo.screen !== 'string') return null;
  const rawParams = userInfo.params;
  let params: Record<string, unknown> = {};
  if (typeof rawParams === 'string') {
    try {
      params = JSON.parse(rawParams);
    } catch {
      params = {};
    }
  } else if (rawParams != null) {
    params = rawParams as Record<string, unknown>;
  }
  return { screen: userInfo.screen, params };
}

/** Shows the OS permission dialog. Call only from the in-app primer, after
 * the athlete has already opted in there — the OS dialog can't be shown
 * again if they deny it, so this is a one-shot per install. */
export async function requestPushPermission(): Promise<boolean> {
  if (!isSupported) return false;
  return nativeModule!.requestPermission();
}

export async function getPushAuthorizationStatus(): Promise<AuthorizationStatus> {
  if (!isSupported) return 'notDetermined';
  return nativeModule!.getAuthorizationStatus();
}

/** The notification (if any) that cold-launched the app — checked once on
 * startup so a tap from Terminated still deep-links, since that path never
 * fires the `pushNotificationOpened` event (there's no JS listener yet at
 * the moment the OS actually delivers it, on either platform). */
export async function getInitialPushNotification(): Promise<PushNotificationPayload | null> {
  if (!isSupported) return null;
  const userInfo = await nativeModule!.getInitialNotification();
  return parsePayload(userInfo);
}

export function parsePushNotificationEvent(userInfo: Record<string, unknown>): PushNotificationPayload | null {
  return parsePayload(userInfo);
}

/** Upserts on `token` (its primary key) rather than (user_id, token), so a
 * device that's since logged into a different account re-points to the new
 * user instead of leaving a stale row behind for the old one. */
export async function registerPushToken(userId: string, token: string): Promise<void> {
  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      { token, user_id: userId, platform: Platform.OS === 'android' ? 'android' : 'ios', last_seen_at: new Date().toISOString() },
      { onConflict: 'token' },
    );
  if (error) {
    // Best-effort — a failed registration just means this device stays
    // silent until the next successful retry (next app open, next token
    // refresh); nothing in the app should block on push working.
    console.warn('registerPushToken failed', error);
  }
}

/** Called on sign-out so a shared/reset device stops receiving pushes for
 * an account that's no longer signed in on it. */
export async function unregisterPushToken(token: string): Promise<void> {
  const { error } = await supabase.from('push_tokens').delete().eq('token', token);
  if (error) console.warn('unregisterPushToken failed', error);
}
