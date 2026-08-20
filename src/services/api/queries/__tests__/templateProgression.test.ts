import { computeSyncedTarget } from '../templateProgression';
import type { LoggedSet } from '../../../../store/activeWorkoutStore';

const EXISTING = { target_sets: 3, target_reps_min: 8, target_reps_max: 10, target_load_kg: 60 };

function set(overrides: Partial<LoggedSet> = {}): LoggedSet {
  return {
    id: 'set-1',
    dbId: 'db-1',
    setNumber: 1,
    reps: 8,
    loadKg: 60,
    rpe: null,
    durationSeconds: null,
    timerStartedAt: null,
    isWarmup: false,
    completed: true,
    ...overrides,
  };
}

describe('computeSyncedTarget', () => {
  it('carries forward more sets than planned', () => {
    const completedSets = [set({ id: 's1' }), set({ id: 's2' }), set({ id: 's3' }), set({ id: 's4' })];
    const patch = computeSyncedTarget(EXISTING, 'weight_kg', completedSets);
    expect(patch).toMatchObject({ target_sets: 4 });
  });

  it('also carries forward fewer sets than planned — always matches the last session exactly', () => {
    const completedSets = [set({ id: 's1' })];
    const patch = computeSyncedTarget(EXISTING, 'weight_kg', completedSets);
    expect(patch).toMatchObject({ target_sets: 1 });
  });

  it('returns null when nothing actually changed', () => {
    const completedSets = [set({ id: 's1', reps: 8 }), set({ id: 's2', reps: 10 }), set({ id: 's3', reps: 9 })];
    const patch = computeSyncedTarget(EXISTING, 'weight_kg', completedSets);
    expect(patch).toBeNull();
  });

  it('carries forward a wider or narrower rep range', () => {
    const wider = computeSyncedTarget(EXISTING, 'weight_kg', [set({ reps: 6 }), set({ reps: 12 })]);
    expect(wider).toMatchObject({ target_reps_min: 6, target_reps_max: 12 });

    const narrower = computeSyncedTarget(EXISTING, 'weight_kg', [set({ reps: 9 }), set({ reps: 9 })]);
    expect(narrower).toMatchObject({ target_reps_min: 9, target_reps_max: 9 });
  });

  it('excludes sets with null reps from the range instead of treating them as 0', () => {
    const completedSets = [set({ reps: 8 }), set({ reps: null }), set({ reps: 11 })];
    const patch = computeSyncedTarget(EXISTING, 'weight_kg', completedSets);
    // min stays 8 (matches existing, so omitted); max moves to 11, computed
    // only from the two real reps values — the null set never contributes a 0.
    expect(patch).toMatchObject({ target_reps_max: 11 });
    expect(patch?.target_reps_min).toBeUndefined();
  });

  it('carries forward a heavier or lighter working weight for weight_kg and weight_lb metrics', () => {
    const heavierKg = computeSyncedTarget(EXISTING, 'weight_kg', [set({ loadKg: 65 })]);
    expect(heavierKg).toMatchObject({ target_load_kg: 65 });

    const heavierLb = computeSyncedTarget(EXISTING, 'weight_lb', [set({ loadKg: 70 })]);
    expect(heavierLb).toMatchObject({ target_load_kg: 70 });

    const lighter = computeSyncedTarget(EXISTING, 'weight_kg', [set({ loadKg: 50 })]);
    expect(lighter).toMatchObject({ target_load_kg: 50 });
  });

  it('never syncs target_load_kg for weight_pct/reps/time metrics, even when loadKg has a value', () => {
    for (const metric of ['weight_pct', 'reps', 'time'] as const) {
      // loadKg is a raw storage slot for these metrics (e.g. a % value), not
      // real kilograms — syncing it would silently corrupt target_load_kg.
      const patch = computeSyncedTarget(EXISTING, metric, [set({ reps: 12, loadKg: 999 })]);
      expect(patch?.target_load_kg).toBeUndefined();
      expect(patch).toMatchObject({ target_reps_min: 12, target_reps_max: 12 }); // reps still sync independently
    }
  });

  it('syncs reps independently of load — a set with reps but no logged weight only updates the rep fields', () => {
    const patch = computeSyncedTarget(EXISTING, 'weight_kg', [set({ reps: 12, loadKg: null })]);
    expect(patch).toMatchObject({ target_reps_min: 12, target_reps_max: 12 });
    expect(patch?.target_load_kg).toBeUndefined();
  });

  it('handles an empty completed-sets array without crashing (callers already skip this case)', () => {
    // Guards the pure function itself even though callers already skip
    // empty-set exercises before calling this — target_sets still diffs
    // correctly against the existing value rather than throwing on an
    // empty reps/loads array.
    const patch = computeSyncedTarget(EXISTING, 'weight_kg', []);
    expect(patch).toMatchObject({ target_sets: 0 });
    expect(patch?.target_reps_min).toBeUndefined();
    expect(patch?.target_load_kg).toBeUndefined();
  });
});
