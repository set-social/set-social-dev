/** Pure route math for GPS-tracked cardio — no React/store/Supabase
 * dependency, per docs/gps-cardio.md's testing section. Everything here
 * operates on a plain, chronologically-ordered point array. */

export type RoutePoint = {
  latitude: number;
  longitude: number;
  /** Epoch ms. */
  recordedAt: number;
  elevationMeters?: number | null;
};

export type Split = {
  /** 1-based split index. */
  index: number;
  distanceKm: number;
  durationSeconds: number;
  paceSecPerKm: number;
};

const EARTH_RADIUS_M = 6_371_000;

/** A GPS fix implying a faster instantaneous speed than this is treated as
 * noise (a bad fix jumping tens/hundreds of meters in one reading) and
 * excluded from distance/pace math rather than corrupting the whole
 * session's numbers — see docs/gps-cardio.md's testing section. ~43 km/h,
 * well above any run/walk/bike pace this feature targets. */
const MAX_PLAUSIBLE_SPEED_M_PER_S = 12;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points, in meters. */
export function haversineDistanceMeters(a: RoutePoint, b: RoutePoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Drops points implying an implausible instantaneous speed from the
 * consecutive-pair the noisy point participates in. Keeps the first point
 * always; each subsequent point is compared against the last *kept* point
 * (not the raw previous point), so one bad fix doesn't also poison the
 * comparison for the point after it. */
export function filterNoisyPoints(points: RoutePoint[]): RoutePoint[] {
  if (points.length === 0) return [];
  const kept: RoutePoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = kept[kept.length - 1];
    const point = points[i];
    const dtSeconds = (point.recordedAt - prev.recordedAt) / 1000;
    if (dtSeconds <= 0) continue;
    const distanceM = haversineDistanceMeters(prev, point);
    const speedMPerS = distanceM / dtSeconds;
    if (speedMPerS > MAX_PLAUSIBLE_SPEED_M_PER_S) continue;
    kept.push(point);
  }
  return kept;
}

/** Total route distance in km, computed over noise-filtered points. */
export function computeDistanceKm(points: RoutePoint[]): number {
  const filtered = filterNoisyPoints(points);
  let totalMeters = 0;
  for (let i = 1; i < filtered.length; i++) {
    totalMeters += haversineDistanceMeters(filtered[i - 1], filtered[i]);
  }
  return totalMeters / 1000;
}

/** Elapsed time between the first and last point, in seconds. Not the same
 * as a session's wall-clock duration when paused — callers tracking a
 * pausable session should pass only the currently-recorded (unpaused)
 * points, or use activeCardioStore's own elapsed-time accounting instead. */
export function computeDurationSeconds(points: RoutePoint[]): number {
  if (points.length < 2) return 0;
  return (points[points.length - 1].recordedAt - points[0].recordedAt) / 1000;
}

export function computePaceSecPerKm(distanceKm: number, durationSeconds: number): number | null {
  if (distanceKm <= 0) return null;
  return durationSeconds / distanceKm;
}

/** One split per completed unit of distance (default 1km), computed by
 * walking the noise-filtered route and cutting a split whenever cumulative
 * distance crosses another whole unitDistanceKm. A route shorter than one
 * full unit produces an empty array, not an error — a valid, common answer
 * for a short session. The final partial unit (if any) is not included as
 * a split — only whole units, matching a normal running app's convention. */
export function computeSplits(points: RoutePoint[], unitDistanceKm: number = 1): Split[] {
  const filtered = filterNoisyPoints(points);
  if (filtered.length < 2) return [];

  const splits: Split[] = [];
  let cumulativeKm = 0;
  let splitStartKm = 0;
  let splitStartTime = filtered[0].recordedAt;
  let nextThreshold = unitDistanceKm;

  for (let i = 1; i < filtered.length; i++) {
    const segmentKm = haversineDistanceMeters(filtered[i - 1], filtered[i]) / 1000;
    const segmentStartKm = cumulativeKm;
    cumulativeKm += segmentKm;

    while (cumulativeKm >= nextThreshold) {
      // Interpolate the timestamp at which this split's distance threshold
      // was actually crossed, rather than crediting the whole segment's time
      // to the split it happened to finish in — otherwise a split's pace
      // would be skewed by wherever a GPS fix happened to land.
      const segmentFraction =
        segmentKm > 0 ? (nextThreshold - segmentStartKm) / segmentKm : 0;
      const crossingTime =
        filtered[i - 1].recordedAt +
        segmentFraction * (filtered[i].recordedAt - filtered[i - 1].recordedAt);

      const splitDistanceKm = nextThreshold - splitStartKm;
      const splitDurationSeconds = (crossingTime - splitStartTime) / 1000;
      splits.push({
        index: splits.length + 1,
        distanceKm: splitDistanceKm,
        durationSeconds: splitDurationSeconds,
        paceSecPerKm: computePaceSecPerKm(splitDistanceKm, splitDurationSeconds) ?? 0,
      });

      splitStartKm = nextThreshold;
      splitStartTime = crossingTime;
      nextThreshold += unitDistanceKm;
    }
  }

  return splits;
}

/** The fastest (lowest sec/km) split, or null when there are none. */
export function bestSplit(splits: Split[]): Split | null {
  if (splits.length === 0) return null;
  return splits.reduce((best, split) => (split.paceSecPerKm < best.paceSecPerKm ? split : best));
}

/** "6:24" style min:sec-per-km display string. */
export function formatPace(secPerKm: number | null | undefined): string {
  if (secPerKm == null || !Number.isFinite(secPerKm) || secPerKm <= 0) return '—';
  const totalSeconds = Math.round(secPerKm);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** "32:07" (or "1:02:07" past an hour) elapsed-duration display string. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}
