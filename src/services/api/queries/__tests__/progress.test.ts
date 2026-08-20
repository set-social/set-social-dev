import { computeE1rmHistories, computeDailyVolume, computeWeeklyVolume, computeStrengthTrend, type LoggedSet } from '../progress';

function loggedSet(overrides: Partial<LoggedSet>): LoggedSet {
  return {
    id: 'set-1',
    exerciseId: 'ex1',
    exerciseName: 'Squat',
    reps: 5,
    loadKg: 100,
    loggedAt: '2024-01-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('computeE1rmHistories', () => {
  it('collapses multiple sets on the same day to that day\'s max e1RM', () => {
    const histories = computeE1rmHistories([
      loggedSet({ id: 's1', loadKg: 100, reps: 5, loggedAt: '2024-01-01T10:00:00.000Z' }),
      loggedSet({ id: 's2', loadKg: 110, reps: 3, loggedAt: '2024-01-01T11:00:00.000Z' }),
      loggedSet({ id: 's3', loadKg: 80, reps: 5, loggedAt: '2024-01-01T12:00:00.000Z' }),
    ]);

    expect(histories).toHaveLength(1);
    expect(histories[0].points).toHaveLength(1);
    expect(histories[0].points[0].date).toBe('2024-01-01');
    expect(histories[0].points[0].e1rm).toBeCloseTo(110 * (1 + 3 / 30), 5);
  });

  it('returns points in chronological order across multiple days', () => {
    const histories = computeE1rmHistories([
      // Noon UTC, not midnight — computeE1rmHistories now buckets by local
      // calendar date (see its own comment), and a midnight-UTC fixture is
      // already "yesterday" local in any negative-UTC-offset test runner,
      // which isn't what this test is about.
      loggedSet({ id: 's1', loggedAt: '2024-01-10T12:00:00.000Z', loadKg: 100 }),
      loggedSet({ id: 's2', loggedAt: '2024-01-01T12:00:00.000Z', loadKg: 90 }),
      loggedSet({ id: 's3', loggedAt: '2024-01-05T12:00:00.000Z', loadKg: 95 }),
    ]);

    expect(histories[0].points.map(p => p.date)).toEqual(['2024-01-01', '2024-01-05', '2024-01-10']);
  });

  it('keeps different exercises in separate histories', () => {
    const histories = computeE1rmHistories([
      loggedSet({ id: 's1', exerciseId: 'ex1', exerciseName: 'Squat', loggedAt: '2024-01-01T00:00:00.000Z' }),
      loggedSet({ id: 's2', exerciseId: 'ex2', exerciseName: 'Bench Press', loggedAt: '2024-01-01T00:00:00.000Z' }),
    ]);

    expect(histories.map(h => h.exerciseId).sort()).toEqual(['ex1', 'ex2']);
  });

  it('ignores sets with no recorded load', () => {
    const histories = computeE1rmHistories([loggedSet({ loadKg: null })]);
    expect(histories).toHaveLength(0);
  });
});

describe('computeDailyVolume', () => {
  it('buckets same-day sets together and returns chronological daily totals', () => {
    const daily = computeDailyVolume([
      loggedSet({ id: 's1', loggedAt: '2024-01-02T09:00:00.000Z', loadKg: 100, reps: 5 }),
      loggedSet({ id: 's2', loggedAt: '2024-01-02T09:30:00.000Z', loadKg: 100, reps: 5 }),
      loggedSet({ id: 's3', loggedAt: '2024-01-01T09:00:00.000Z', loadKg: 50, reps: 10 }),
    ]);

    expect(daily).toEqual([
      { date: '2024-01-01', volume: 500 },
      { date: '2024-01-02', volume: 1000 },
    ]);
  });

  it('ignores sets with no recorded load', () => {
    expect(computeDailyVolume([loggedSet({ loadKg: null })])).toHaveLength(0);
  });

  it('gives a multi-point trend for a few sessions logged within the same calendar week, unlike computeWeeklyVolume', () => {
    const sets = [
      loggedSet({ id: 's1', loggedAt: '2024-01-01T09:00:00.000Z', loadKg: 100, reps: 5 }),
      loggedSet({ id: 's2', loggedAt: '2024-01-03T09:00:00.000Z', loadKg: 100, reps: 5 }),
      loggedSet({ id: 's3', loggedAt: '2024-01-05T09:00:00.000Z', loadKg: 100, reps: 5 }),
    ];

    expect(computeWeeklyVolume(sets)).toHaveLength(1);
    expect(computeDailyVolume(sets)).toHaveLength(3);
  });
});

describe('computeStrengthTrend', () => {
  const now = new Date('2024-01-10T12:00:00.000Z'); // Wednesday

  it('defaults to the last 7 days for the "1w" range', () => {
    const sets = [
      loggedSet({ id: 's1', loggedAt: '2024-01-09T09:00:00.000Z', loadKg: 100, reps: 5 }),
      loggedSet({ id: 's2', loggedAt: '2024-01-01T09:00:00.000Z', loadKg: 100, reps: 5 }), // 9 days before `now` — outside 1w
    ];

    expect(computeStrengthTrend(sets, '1w', now)).toEqual([{ date: '2024-01-09', volume: 500 }]);
  });

  it('widens to the last 14 days for the "2w" range', () => {
    const sets = [
      loggedSet({ id: 's1', loggedAt: '2024-01-09T09:00:00.000Z', loadKg: 100, reps: 5 }),
      loggedSet({ id: 's2', loggedAt: '2023-12-29T09:00:00.000Z', loadKg: 100, reps: 5 }), // 12 days before `now` — inside 2w
      loggedSet({ id: 's3', loggedAt: '2023-12-01T09:00:00.000Z', loadKg: 100, reps: 5 }), // ~40 days before `now` — outside 2w
    ];

    expect(computeStrengthTrend(sets, '2w', now).map(p => p.date)).toEqual(['2023-12-29', '2024-01-09']);
  });

  it('widens to the last 30 days for the "1m" range', () => {
    const sets = [
      loggedSet({ id: 's1', loggedAt: '2023-12-15T09:00:00.000Z', loadKg: 100, reps: 5 }), // 26 days before `now` — inside 1m
      loggedSet({ id: 's2', loggedAt: '2023-11-01T09:00:00.000Z', loadKg: 100, reps: 5 }), // over 2 months before — outside 1m
    ];

    expect(computeStrengthTrend(sets, '1m', now).map(p => p.date)).toEqual(['2023-12-15']);
  });

  it('buckets by calendar week rather than by day for the "ytd" range', () => {
    const sets = [
      loggedSet({ id: 's1', loggedAt: '2024-01-02T09:00:00.000Z', loadKg: 100, reps: 5 }), // same ISO week as s2
      loggedSet({ id: 's2', loggedAt: '2024-01-04T09:00:00.000Z', loadKg: 100, reps: 5 }),
    ];

    const trend = computeStrengthTrend(sets, 'ytd', now);
    expect(trend).toHaveLength(1);
    expect(trend[0].volume).toBe(1000);
  });

  it('excludes sets from before the start of the year for the "ytd" range', () => {
    const sets = [loggedSet({ id: 's1', loggedAt: '2023-12-15T09:00:00.000Z', loadKg: 100, reps: 5 })];
    expect(computeStrengthTrend(sets, 'ytd', now)).toHaveLength(0);
  });

  it('ignores sets with no recorded load', () => {
    expect(computeStrengthTrend([loggedSet({ loadKg: null })], '1w', now)).toHaveLength(0);
  });
});
