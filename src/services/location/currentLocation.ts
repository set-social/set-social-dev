import { PermissionsAndroid, Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';

export type Coordinates = { latitude: number; longitude: number };

/** Thrown for both "permission denied" and "position unavailable" — callers
 * only ever need to tell the athlete check-in didn't work, not which of the
 * two native reasons caused it. */
export class LocationUnavailableError extends Error {}

/**
 * One-shot foreground location read for a gym check-in — never a
 * subscription, never background. iOS shows its permission prompt the
 * moment getCurrentPosition is first called (driven by
 * NSLocationWhenInUseUsageDescription in Info.plist); Android needs the
 * runtime permission requested explicitly first, which is all this
 * function adds on top of the bare library call.
 */
export async function getCurrentLocation(): Promise<Coordinates> {
  if (Platform.OS === 'android') {
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new LocationUnavailableError('Location permission was not granted.');
    }
  }

  return new Promise((resolve, reject) => {
    Geolocation.getCurrentPosition(
      position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      error => reject(new LocationUnavailableError(error.message || 'Could not determine your location.')),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}
