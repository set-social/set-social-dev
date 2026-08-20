import { Platform } from 'react-native';
import { PROVIDER_GOOGLE } from 'react-native-maps';

/** Android renders through the Google Maps SDK (the API key wired into
 * AndroidManifest.xml); iOS renders through Apple MapKit, react-native-maps'
 * default provider there — passing PROVIDER_GOOGLE on iOS would require the
 * separate GoogleMaps CocoaPod plus its own iOS API key, neither of which
 * is installed, and would fail at runtime. Shared by
 * LiveCardioTrackingScreen and CardioRunSummaryScreen so the platform check
 * lives in exactly one place. */
export const MAP_PROVIDER = Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined;
