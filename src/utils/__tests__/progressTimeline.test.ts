import { buildProgressTimeline } from '../progressTimeline';
import type { PrEvent } from '../../services/api/queries/progress';
import type { CompletedWorkoutLog } from '../../services/api/queries/workoutLogs';

function prEvent(overrides: Partial<PrEvent>): PrEvent {
  return {
    exerciseId: 'ex1',
    exerciseName: 'Squat',
    loadKg: 100,
    reps: 5,
    e1rm: 116.7,
    loggedAt: '2024-02-10T00:00:00.000Z',
    ...overrides,
  };
}

function workoutLog(overrides: Partial<CompletedWorkoutLog>): CompletedWorkoutLog {
  return { id: 'log-1', completedAt: '2024-02-10T00:00:00.000Z', title: 'Push Day', rating: null, ...overrides };
}

describe('buildProgressTimeline', () => {
  it('returns an empty array for empty input', () => {
    expect(buildProgressTimeline([], [], [])).toEqual([]);
  });

  it('merges all three entry types and sorts them descending by date', () => {
    const entries = buildProgressTimeline(
      [prEvent({ loggedAt: '2024-01-05T00:00:00.000Z' })],
      [{ logged_at: '2024-01-15', weight_kg: 80 }],
      [workoutLog({ id: 'log-1', completedAt: '2024-01-10T00:00:00.000Z' })],
    );

    expect(entries.map(e => e.type)).toEqual(['body_metric', 'workout_completed', 'pr']);
    expect(entries.map(e => e.date.slice(0, 10))).toEqual(['2024-01-15', '2024-01-10', '2024-01-05']);
  });

  it('places a milestone entry exactly on the Nth completed workout, not off by one', () => {
    const logs = Array.from({ length: 10 }, (_, i) =>
      workoutLog({ id: `log-${i + 1}`, completedAt: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` }),
    );

    const entries = buildProgressTimeline([], [], logs);
    const milestones = entries.filter(e => e.type === 'milestone');

    expect(milestones).toHaveLength(1);
    expect(milestones[0]).toMatchObject({ count: 10, date: logs[9].completedAt });

    const nineWorkouts = buildProgressTimeline([], [], logs.slice(0, 9));
    expect(nineWorkouts.filter(e => e.type === 'milestone')).toHaveLength(0);
  });

  it('produces one entry per completed workout regardless of milestone status', () => {
    const logs = [workoutLog({ id: 'log-1', completedAt: '2024-01-01T00:00:00.000Z' })];
    const entries = buildProgressTimeline([], [], logs);
    expect(entries.filter(e => e.type === 'workout_completed')).toHaveLength(1);
  });
});
