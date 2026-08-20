import { estimateMET, estimateCardioCalories } from '../cardioCalories';

describe('estimateMET', () => {
  it('reproduces the well-known "12-3-30" treadmill MET (~9.5) from incline + speed', () => {
    const met = estimateMET('treadmill', { inclinePct: 12, speedKmh: 5.63 }); // 3.5 mph
    expect(met).toBeGreaterThan(8.5);
    expect(met).toBeLessThan(10.5);
  });

  it('gives a flat treadmill walk a MET close to the walking reference (3.5)', () => {
    const met = estimateMET('treadmill', { inclinePct: 0, speedKmh: 5.6 }); // ~3.5 mph
    expect(met).toBeGreaterThan(3);
    expect(met).toBeLessThan(4.5);
  });

  it('increases MET with incline at a fixed speed', () => {
    const flat = estimateMET('treadmill', { inclinePct: 0, speedKmh: 5.6 });
    const inclined = estimateMET('treadmill', { inclinePct: 12, speedKmh: 5.6 });
    expect(inclined).toBeGreaterThan(flat);
  });

  it('switches to the running equation above the walk/run speed threshold', () => {
    const met = estimateMET('treadmill', { inclinePct: 0, speedKmh: 9.7 }); // ~6 mph
    expect(met).toBeGreaterThan(8);
  });

  it('falls back to the walking base MET when treadmill has no speed input', () => {
    expect(estimateMET('treadmill', {})).toBe(3.5);
  });

  it('uses the flat reference MET for non-treadmill activities with no effort given', () => {
    expect(estimateMET('bike', {})).toBe(7.0);
    expect(estimateMET('elliptical', {})).toBe(5.0);
    expect(estimateMET('swim', {})).toBe(6.0);
  });

  it('scales non-treadmill activities by effort', () => {
    expect(estimateMET('bike', { effort: 'easy' })).toBeCloseTo(7.0 * 0.75);
    expect(estimateMET('bike', { effort: 'hard' })).toBeCloseTo(7.0 * 1.35);
  });

  it('gives custom activities a generic moderate-cardio MET rather than refusing to estimate', () => {
    expect(estimateMET('custom', {})).toBe(5.0);
    expect(estimateMET('custom', { effort: 'hard' })).toBeCloseTo(5.0 * 1.35);
  });
});

describe('estimateCardioCalories', () => {
  it('matches the worked example from the feature plan (~380 kcal)', () => {
    const calories = estimateCardioCalories({
      activity: 'treadmill',
      durationMinutes: 32,
      inclinePct: 12,
      speedKmh: 5.63, // 3.5 mph
      weightKg: 75,
    });
    expect(calories).toBeGreaterThan(350);
    expect(calories).toBeLessThan(410);
  });

  it('scales linearly with duration', () => {
    const base = { activity: 'bike' as const, effort: 'moderate' as const, weightKg: 80 };
    const thirty = estimateCardioCalories({ ...base, durationMinutes: 30 });
    const sixty = estimateCardioCalories({ ...base, durationMinutes: 60 });
    expect(sixty).toBeCloseTo(thirty * 2, -1);
  });

  it('scales with bodyweight', () => {
    const base = { activity: 'row' as const, effort: 'moderate' as const, durationMinutes: 30 };
    const lighter = estimateCardioCalories({ ...base, weightKg: 60 });
    const heavier = estimateCardioCalories({ ...base, weightKg: 90 });
    expect(heavier).toBeGreaterThan(lighter);
  });

  it('returns a whole number', () => {
    const calories = estimateCardioCalories({ activity: 'swim', durationMinutes: 22, weightKg: 68.4 });
    expect(Number.isInteger(calories)).toBe(true);
  });

  it('leaves the estimate unchanged with no sex given, or sex: male', () => {
    const base = { activity: 'bike' as const, effort: 'moderate' as const, durationMinutes: 30, weightKg: 80 };
    const noSex = estimateCardioCalories(base);
    expect(estimateCardioCalories({ ...base, sex: null })).toBe(noSex);
    expect(estimateCardioCalories({ ...base, sex: 'male' })).toBe(noSex);
  });

  it('applies a modest downward adjustment for sex: female', () => {
    const base = { activity: 'bike' as const, effort: 'moderate' as const, durationMinutes: 30, weightKg: 80 };
    const unadjusted = estimateCardioCalories(base);
    const adjusted = estimateCardioCalories({ ...base, sex: 'female' });
    expect(adjusted).toBeLessThan(unadjusted);
    expect(adjusted).toBeCloseTo(unadjusted * 0.92, -1);
  });
});
