import { toSnapshot, type CustomExerciseDetail } from '../workoutShares';

type FakeExerciseRow = {
  id: string;
  name: string;
  is_custom: boolean;
  created_by: string | null;
  created_at: string;
} & CustomExerciseDetail;

function customExercise(id: string, name: string): FakeExerciseRow {
  return {
    id,
    name,
    is_custom: true,
    created_by: 'sender-1',
    created_at: '2026-01-01T00:00:00.000Z',
    category: 'push',
    primary_muscle: 'chest',
    equipment: 'other',
    instructions: null,
    movement_pattern: null,
    secondary_muscles: [],
    difficulty: null,
    joint_stress: null,
    skill_requirement: null,
    default_metric: null,
    demo_media_url: null,
    demo_media_type: null,
  };
}

describe('toSnapshot', () => {
  const meta = { name: 'Push Day', notes: 'Focus on tempo', estimatedDurationMinutes: 45 };

  it('maps every field and carries meta through unchanged', () => {
    const snapshot = toSnapshot(
      meta,
      [
        {
          exercise_id: 'ex-1',
          exercises: { name: 'Bench Press' },
          order_index: 0,
          target_sets: 3,
          target_reps_min: 8,
          target_reps_max: 12,
          target_rpe: 8,
          rest_seconds: 90,
          notes: 'Pause at the bottom',
        },
      ],
      new Map(),
    );

    expect(snapshot.name).toBe('Push Day');
    expect(snapshot.notes).toBe('Focus on tempo');
    expect(snapshot.estimatedDurationMinutes).toBe(45);
    expect(snapshot.exercises).toEqual([
      {
        exerciseId: 'ex-1',
        exerciseName: 'Bench Press',
        isCustom: false,
        customExerciseDetail: null,
        orderIndex: 0,
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
        targetRpe: 8,
        restSeconds: 90,
        notes: 'Pause at the bottom',
      },
    ]);
  });

  it('sorts exercises by order_index regardless of input order', () => {
    const snapshot = toSnapshot(
      meta,
      [
        { exercise_id: 'ex-2', exercises: { name: 'Second' }, order_index: 1, target_sets: 3, target_reps_min: 8, target_reps_max: 12, target_rpe: null, rest_seconds: null, notes: null },
        { exercise_id: 'ex-1', exercises: { name: 'First' }, order_index: 0, target_sets: 3, target_reps_min: 8, target_reps_max: 12, target_rpe: null, rest_seconds: null, notes: null },
      ],
      new Map(),
    );

    expect(snapshot.exercises.map(e => e.exerciseName)).toEqual(['First', 'Second']);
  });

  it('marks an exercise custom and captures its recreation detail when present in detailsById, false/null otherwise', () => {
    const custom = customExercise('ex-custom', 'My Weird Machine');
    const snapshot = toSnapshot(
      meta,
      [
        { exercise_id: 'ex-custom', exercises: { name: 'My Weird Machine' }, order_index: 0, target_sets: 3, target_reps_min: 8, target_reps_max: 12, target_rpe: null, rest_seconds: null, notes: null },
        { exercise_id: 'ex-stock', exercises: { name: 'Squat' }, order_index: 1, target_sets: 3, target_reps_min: 8, target_reps_max: 12, target_rpe: null, rest_seconds: null, notes: null },
      ],
      new Map([['ex-custom', custom]]),
    );

    const customResult = snapshot.exercises.find(e => e.exerciseId === 'ex-custom');
    expect(customResult?.isCustom).toBe(true);
    expect(customResult?.customExerciseDetail).toEqual({
      category: 'push',
      primary_muscle: 'chest',
      equipment: 'other',
      instructions: null,
      movement_pattern: null,
      secondary_muscles: [],
      difficulty: null,
      joint_stress: null,
      skill_requirement: null,
      default_metric: null,
      demo_media_url: null,
      demo_media_type: null,
    });

    const stockResult = snapshot.exercises.find(e => e.exerciseId === 'ex-stock');
    expect(stockResult?.isCustom).toBe(false);
    expect(stockResult?.customExerciseDetail).toBeNull();
  });
});
