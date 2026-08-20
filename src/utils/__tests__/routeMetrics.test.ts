import {
  haversineDistanceMeters,
  filterNoisyPoints,
  computeDistanceKm,
  computeDurationSeconds,
  computePaceSecPerKm,
  computeSplits,
  bestSplit,
  formatPace,
  formatDuration,
  type RoutePoint,
} from '../routeMetrics';

const START = { latitude: 37.7749, longitude: -122.4194 };
// ~111.19m north per 0.001 degree latitude, at the equator-ish scale used
// here — close enough for these fixtures, which only assert order-of-
// magnitude/direction, not survey-grade precision.
const NORTH_STEP_DEG = 0.001;

function point(latOffset: number, lonOffset: number, recordedAt: number, elevationMeters?: number): RoutePoint {
  return {
    latitude: START.latitude + latOffset,
    longitude: START.longitude + lonOffset,
    recordedAt,
    elevationMeters,
  };
}

describe('haversineDistanceMeters', () => {
  it('returns 0 for identical points', () => {
    const p = point(0, 0, 0);
    expect(haversineDistanceMeters(p, p)).toBe(0);
  });

  it('returns a plausible distance for a known offset', () => {
    const a = point(0, 0, 0);
    const b = point(NORTH_STEP_DEG, 0, 1000);
    const distance = haversineDistanceMeters(a, b);
    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(120);
  });
});

describe('filterNoisyPoints', () => {
  it('keeps a normal walking/running-pace sequence intact', () => {
    const points: RoutePoint[] = [
      point(0, 0, 0),
      point(NORTH_STEP_DEG, 0, 60_000),
      point(NORTH_STEP_DEG * 2, 0, 120_000),
    ];
    expect(filterNoisyPoints(points)).toHaveLength(3);
  });

  it('drops a point implying an implausible jump', () => {
    const points: RoutePoint[] = [
      point(0, 0, 0),
      // ~1.1km in 1 second — a bad GPS fix, not a real run.
      point(0.01, 0, 1000),
      point(NORTH_STEP_DEG * 2, 0, 60_000),
    ];
    const filtered = filterNoisyPoints(points);
    expect(filtered).toHaveLength(2);
    expect(filtered[1].recordedAt).toBe(60_000);
  });

  it('drops non-positive-time-delta points (duplicate/out-of-order timestamps)', () => {
    const points: RoutePoint[] = [point(0, 0, 1000), point(NORTH_STEP_DEG, 0, 1000)];
    expect(filterNoisyPoints(points)).toHaveLength(1);
  });

  it('returns an empty array for empty input', () => {
    expect(filterNoisyPoints([])).toEqual([]);
  });
});

describe('computeDistanceKm', () => {
  it('is 0 for fewer than 2 points', () => {
    expect(computeDistanceKm([])).toBe(0);
    expect(computeDistanceKm([point(0, 0, 0)])).toBe(0);
  });

  it('sums consecutive-point distance over a multi-point route', () => {
    const points: RoutePoint[] = [
      point(0, 0, 0),
      point(NORTH_STEP_DEG, 0, 60_000),
      point(NORTH_STEP_DEG * 2, 0, 120_000),
    ];
    const distanceKm = computeDistanceKm(points);
    // Two ~111m legs.
    expect(distanceKm).toBeGreaterThan(0.2);
    expect(distanceKm).toBeLessThan(0.24);
  });

  it('excludes a noisy jump from the total', () => {
    const clean: RoutePoint[] = [point(0, 0, 0), point(NORTH_STEP_DEG, 0, 60_000)];
    const withNoise: RoutePoint[] = [...clean, point(0.05, 0, 61_000)];
    expect(computeDistanceKm(withNoise)).toBeCloseTo(computeDistanceKm(clean), 5);
  });
});

describe('computeDurationSeconds', () => {
  it('is 0 for fewer than 2 points', () => {
    expect(computeDurationSeconds([point(0, 0, 0)])).toBe(0);
  });

  it('is the gap between the first and last point', () => {
    const points = [point(0, 0, 0), point(0, 0, 5000), point(0, 0, 12_000)];
    expect(computeDurationSeconds(points)).toBe(12);
  });
});

describe('computePaceSecPerKm', () => {
  it('is null for zero/negative distance', () => {
    expect(computePaceSecPerKm(0, 300)).toBeNull();
    expect(computePaceSecPerKm(-1, 300)).toBeNull();
  });

  it('divides duration by distance', () => {
    expect(computePaceSecPerKm(2, 720)).toBe(360);
  });
});

describe('computeSplits', () => {
  function buildRunAt(paceSecPerKm: number, totalKm: number): RoutePoint[] {
    // One point every 10 seconds, moving north at a constant pace.
    const points: RoutePoint[] = [];
    const totalSeconds = paceSecPerKm * totalKm;
    const stepSeconds = 10;
    const stepCount = Math.floor(totalSeconds / stepSeconds);
    const kmPerStep = totalKm / stepCount;
    // ~111.19m per 0.001 deg — invert to get deg-per-km for this fixture's
    // scale, consistent with NORTH_STEP_DEG above.
    const degPerKm = NORTH_STEP_DEG / 0.11119;
    for (let i = 0; i <= stepCount; i++) {
      points.push(point(degPerKm * kmPerStep * i, 0, i * stepSeconds * 1000));
    }
    return points;
  }

  it('returns an empty array for a route shorter than one unit', () => {
    const points = buildRunAt(300, 0.3);
    expect(computeSplits(points, 1)).toEqual([]);
  });

  it('produces one split per completed km at a steady pace', () => {
    const points = buildRunAt(300, 3.2);
    const splits = computeSplits(points, 1);
    expect(splits).toHaveLength(3);
    splits.forEach((split, i) => {
      expect(split.index).toBe(i + 1);
      expect(split.distanceKm).toBeCloseTo(1, 1);
      expect(split.paceSecPerKm).toBeGreaterThan(280);
      expect(split.paceSecPerKm).toBeLessThan(320);
    });
  });

  it('does not include a trailing partial unit as a split', () => {
    const points = buildRunAt(300, 2.5);
    const splits = computeSplits(points, 1);
    expect(splits).toHaveLength(2);
  });
});

describe('bestSplit', () => {
  it('is null for an empty list', () => {
    expect(bestSplit([])).toBeNull();
  });

  it('picks the lowest sec/km split', () => {
    const splits = [
      { index: 1, distanceKm: 1, durationSeconds: 360, paceSecPerKm: 360 },
      { index: 2, distanceKm: 1, durationSeconds: 300, paceSecPerKm: 300 },
      { index: 3, distanceKm: 1, durationSeconds: 330, paceSecPerKm: 330 },
    ];
    expect(bestSplit(splits)?.index).toBe(2);
  });
});

describe('formatPace', () => {
  it('formats whole and sub-minute seconds with zero-padding', () => {
    expect(formatPace(384)).toBe('6:24');
    expect(formatPace(305)).toBe('5:05');
  });

  it('renders a placeholder for missing/invalid input', () => {
    expect(formatPace(null)).toBe('—');
    expect(formatPace(undefined)).toBe('—');
    expect(formatPace(0)).toBe('—');
    expect(formatPace(NaN)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('formats under an hour as m:ss', () => {
    expect(formatDuration(127)).toBe('2:07');
  });

  it('formats an hour or more as h:mm:ss', () => {
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});
