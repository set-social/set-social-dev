import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import type { RoutePoint } from '../../utils/routeMetrics';
import { LocationUnavailableError } from './currentLocation';

/** Result of requesting the permissions a live-tracked session wants.
 * `foreground` must be true for tracking to work at all; `background` is
 * best-effort — false just means the route will show a gap for however
 * long the app was backgrounded (see docs/gps-cardio.md), not a hard
 * failure. */
export type CardioLocationPermission = { foreground: boolean; background: boolean };

/** Android 10 (API 29) is the one OS version where requesting
 * ACCESS_BACKGROUND_LOCATION actually shows a runtime dialog — on 11+
 * (API 30+) the system silently withholds it from a normal runtime
 * request and the user has to grant "Allow all the time" from Settings
 * directly (LiveCardioTrackingScreen's permission UI links there when this
 * comes back false). Requesting it is still harmless/correct on every
 * version — the check for whether a dialog will actually appear lives in
 * the OS, not here. */
async function requestAndroidBackgroundLocation(): Promise<boolean> {
  if (Platform.OS !== 'android' || Platform.Version < 29) return true;
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * Requests what a live GPS session needs, distinct from
 * currentLocation.ts's one-shot check-in permission: that flow only ever
 * asks for foreground access and never touches this module's iOS
 * `authorizationLevel` configuration. This one explicitly asks for
 * "Always" on iOS (required for `allowsBackgroundLocationUpdates` to take
 * effect — see startRouteTracking) and, on Android, a second
 * ACCESS_BACKGROUND_LOCATION request after foreground is confirmed
 * (bundling both in one request is rejected by the OS on Android 11+).
 */
export async function requestCardioTrackingPermission(): Promise<CardioLocationPermission> {
  if (Platform.OS === 'android') {
    const fineGranted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    const foreground = fineGranted === PermissionsAndroid.RESULTS.GRANTED;
    if (!foreground) return { foreground: false, background: false };
    const background = await requestAndroidBackgroundLocation();
    return { foreground: true, background };
  }

  // iOS: 'always' still resolves successfully with only "When In Use"
  // granted (see RNCGeolocation's authorization callback) — `background`
  // reflects whether allowsBackgroundLocationUpdates will actually take,
  // which needs the upgraded "Always" grant. There's no synchronous status
  // read on this library, so this is a best-effort: assume background
  // tracking will work once foreground does, and let the AppState gap
  // banner (LiveCardioTrackingScreen) be the honest signal if it didn't.
  Geolocation.setRNConfiguration({ skipPermissionRequests: false, authorizationLevel: 'always' });
  const foreground = await new Promise<boolean>(resolve => {
    Geolocation.requestAuthorization(
      () => resolve(true),
      () => resolve(false),
    );
  });
  return { foreground, background: foreground };
}

/** Restores the shared Geolocation native module's configuration to its
 * default (foreground-only) behavior — must run once a tracking session
 * ends. `setRNConfiguration` mutates process-wide state on this native
 * module; leaving `authorizationLevel: 'always'` set after a run would
 * silently make the unrelated "At My Gym" one-shot check-in
 * (currentLocation.ts) start requesting Always authorization too. */
function resetLocationConfiguration(): void {
  if (Platform.OS === 'ios') {
    Geolocation.setRNConfiguration({ skipPermissionRequests: false, authorizationLevel: 'auto' });
  }
}

const { CardioTrackingService } = NativeModules as {
  CardioTrackingService?: { start: () => void; stop: () => void };
};

/** Starts (Android only — a no-op elsewhere) the minimal foreground
 * service that keeps this app process alive and exempt from background
 * execution/Doze throttling while a run is in progress. It does no
 * location work itself; `watchPosition` below keeps running in the JS
 * engine exactly as it does in the foreground, the service just stops the
 * OS from suspending that JS engine once there's no visible activity. See
 * android/app/src/main/java/com/gymbee/CardioTrackingService.kt. */
function startAndroidForegroundService(): void {
  if (Platform.OS === 'android') CardioTrackingService?.start();
}

function stopAndroidForegroundService(): void {
  if (Platform.OS === 'android') CardioTrackingService?.stop();
}

const WATCH_OPTIONS = {
  enableHighAccuracy: true,
  // Fires on ~10m of movement rather than a pure timer — see
  // docs/gps-cardio.md's "Battery/accuracy tradeoffs".
  distanceFilter: 10,
  // Backstop so pace still updates at a reasonable cadence during slow,
  // steady movement (Android honors this as a provider interval hint;
  // iOS's CoreLocation update cadence is driven by distanceFilter alone,
  // so this is a no-op there, which is fine — it's a floor, not a
  // requirement).
  interval: 5000,
  fastestInterval: 5000,
  maximumAge: 0,
  timeout: 30_000,
};

/**
 * Begins continuous position updates for a live cardio session. Callers
 * must have already confirmed `requestCardioTrackingPermission().foreground`
 * — this does not itself gate on permission, matching getCurrentLocation's
 * split of "ask" vs. "use" in currentLocation.ts.
 */
export function startRouteTracking(
  onPoint: (point: RoutePoint) => void,
  onError: (error: LocationUnavailableError) => void,
): number {
  startAndroidForegroundService();
  return Geolocation.watchPosition(
    position => {
      onPoint({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        recordedAt: position.timestamp,
        elevationMeters: position.coords.altitude ?? null,
      });
    },
    error => onError(new LocationUnavailableError(error.message || 'Lost location tracking.')),
    WATCH_OPTIONS,
  );
}

/** Stops position updates and tears down every piece startRouteTracking
 * turned on — always call this on Finish *and* Discard, not just Finish. */
export function stopRouteTracking(watchId: number): void {
  Geolocation.clearWatch(watchId);
  stopAndroidForegroundService();
  resetLocationConfiguration();
}
