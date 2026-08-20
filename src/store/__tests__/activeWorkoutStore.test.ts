import { useActiveWorkoutStore, isExerciseComplete } from '../activeWorkoutStore';
import { useRestTimerPreferenceStore } from '../restTimerPreferenceStore';

const EXERCISE = { exerciseId: 'ex1', exerciseName: 'Bench Press', targetSets: 1 };

function seedWorkout() {
  useActiveWorkoutStore.getState().startWorkout({
    workoutLogId: 'wl-1',
    source: { type: 'freestyle', id: null },
    exercises: [EXERCISE],
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  useActiveWorkoutStore.getState().reset();
  useRestTimerPreferenceStore.getState().setRestTimerEnabled(true);
});

afterEach(() => {
  useActiveWorkoutStore.getState().reset();
  useRestTimerPreferenceStore.getState().setRestTimerEnabled(true);
  jest.useRealTimers();
});

describe('activeWorkoutStore rest timer', () => {
  it('decrements by exactly 1 per second, not 2', () => {
    seedWorkout();
    useActiveWorkoutStore.getState().startRestTimer(10);

    jest.advanceTimersByTime(1000);
    expect(useActiveWorkoutStore.getState().restSecondsRemaining).toBe(9);

    jest.advanceTimersByTime(1000);
    expect(useActiveWorkoutStore.getState().restSecondsRemaining).toBe(8);

    jest.advanceTimersByTime(3000);
    expect(useActiveWorkoutStore.getState().restSecondsRemaining).toBe(5);
  });

  it('starting a new rest timer while one is already running never double-ticks', () => {
    seedWorkout();
    useActiveWorkoutStore.getState().startRestTimer(60);
    jest.advanceTimersByTime(2000);
    expect(useActiveWorkoutStore.getState().restSecondsRemaining).toBe(58);

    // Restarting (e.g. a second "increase_rest" recommendation) must clear
    // the first interval — if it didn't, both would tick the same counter
    // and it would decrement by 2 per second instead of 1.
    useActiveWorkoutStore.getState().startRestTimer(30);
    jest.advanceTimersByTime(1000);
    expect(useActiveWorkoutStore.getState().restSecondsRemaining).toBe(29);
  });

  it('stops ticking and clears restRunning once it reaches 0', () => {
    seedWorkout();
    useActiveWorkoutStore.getState().startRestTimer(2);
    jest.advanceTimersByTime(3000);
    expect(useActiveWorkoutStore.getState().restSecondsRemaining).toBe(0);
    expect(useActiveWorkoutStore.getState().restRunning).toBe(false);

    // No stray interval left running — further ticks are a no-op.
    jest.advanceTimersByTime(5000);
    expect(useActiveWorkoutStore.getState().restSecondsRemaining).toBe(0);
  });

  it('skipRestTimer stops the interval immediately', () => {
    seedWorkout();
    useActiveWorkoutStore.getState().startRestTimer(60);
    useActiveWorkoutStore.getState().skipRestTimer();
    expect(useActiveWorkoutStore.getState().restRunning).toBe(false);

    jest.advanceTimersByTime(5000);
    expect(useActiveWorkoutStore.getState().restSecondsRemaining).toBe(0);
  });

  it('starting a fresh workout clears any stray interval from a prior session', () => {
    seedWorkout();
    useActiveWorkoutStore.getState().startRestTimer(60);

    seedWorkout();
    jest.advanceTimersByTime(5000);
    // The new session's rest timer was never started, so it should still read 0.
    expect(useActiveWorkoutStore.getState().restSecondsRemaining).toBe(0);
    expect(useActiveWorkoutStore.getState().restRunning).toBe(false);
  });

  it('correctly catches up after a gap with no ticks in between, simulating the app being backgrounded', () => {
    // RN suspends JS timer callbacks while backgrounded — the interval
    // doesn't fire extra times to "catch up" on its own, it just doesn't
    // fire at all until the app resumes. Advance the fake clock directly
    // (not jest.advanceTimersByTime, which would fire the pending interval
    // callbacks) to reproduce that exact gap, then fire a single tick like
    // the AppState 'active' listener does on resume.
    seedWorkout();
    useActiveWorkoutStore.getState().startRestTimer(60);
    jest.setSystemTime(Date.now() + 45_000);

    useActiveWorkoutStore.getState().tickRestTimer();
    expect(useActiveWorkoutStore.getState().restSecondsRemaining).toBe(15);
    expect(useActiveWorkoutStore.getState().restRunning).toBe(true);
  });

  it('correctly completes (not stalls) when the backgrounded gap outlasts the remaining rest time', () => {
    seedWorkout();
    useActiveWorkoutStore.getState().startRestTimer(20);
    jest.setSystemTime(Date.now() + 45_000);

    useActiveWorkoutStore.getState().tickRestTimer();
    expect(useActiveWorkoutStore.getState().restSecondsRemaining).toBe(0);
    expect(useActiveWorkoutStore.getState().restRunning).toBe(false);
  });

  it('does not start a rest timer when the Settings preference is disabled', () => {
    seedWorkout();
    useRestTimerPreferenceStore.getState().setRestTimerEnabled(false);

    useActiveWorkoutStore.getState().startRestTimer(60);
    expect(useActiveWorkoutStore.getState().restRunning).toBe(false);
    expect(useActiveWorkoutStore.getState().restSecondsRemaining).toBe(0);

    jest.advanceTimersByTime(5000);
    expect(useActiveWorkoutStore.getState().restSecondsRemaining).toBe(0);
  });
});

describe('activeWorkoutStore set timer (Timer metric stopwatch)', () => {
  it('records elapsed duration on stop', () => {
    seedWorkout();
    const setId = useActiveWorkoutStore.getState().exercises[0].sets[0].id;

    useActiveWorkoutStore.getState().startSetTimer('ex1', setId);
    jest.advanceTimersByTime(45_000);
    useActiveWorkoutStore.getState().stopSetTimer('ex1', setId);

    const set = useActiveWorkoutStore.getState().exercises[0].sets[0];
    expect(set.durationSeconds).toBe(45);
    expect(set.timerStartedAt).toBeNull();
  });

  it('only one set timer runs at a time — starting another clears the first', () => {
    seedWorkout();
    useActiveWorkoutStore.getState().addSet('ex1');
    const [setA, setB] = useActiveWorkoutStore.getState().exercises[0].sets;

    useActiveWorkoutStore.getState().startSetTimer('ex1', setA.id);
    expect(
      useActiveWorkoutStore.getState().exercises[0].sets.find(s => s.id === setA.id)?.timerStartedAt,
    ).not.toBeNull();

    useActiveWorkoutStore.getState().startSetTimer('ex1', setB.id);
    const sets = useActiveWorkoutStore.getState().exercises[0].sets;
    expect(sets.find(s => s.id === setA.id)?.timerStartedAt).toBeNull();
    expect(sets.find(s => s.id === setB.id)?.timerStartedAt).not.toBeNull();
  });
});

describe('activeWorkoutStore removeSet', () => {
  function seedThreeSetExercise() {
    useActiveWorkoutStore.getState().startWorkout({
      workoutLogId: 'wl-1',
      source: { type: 'freestyle', id: null },
      exercises: [{ exerciseId: 'ex1', exerciseName: 'Bench Press', targetSets: 3 }],
    });
  }

  it('clamps targetSets down when removal drops the set count below it, so completion stays reachable', () => {
    seedThreeSetExercise();
    const [setA, setB, setC] = useActiveWorkoutStore.getState().exercises[0].sets;

    useActiveWorkoutStore.getState().removeSet('ex1', setC.id);

    const exercise = useActiveWorkoutStore.getState().exercises[0];
    expect(exercise.sets).toHaveLength(2);
    expect(exercise.targetSets).toBe(2);

    // Completing every remaining set now actually satisfies completion —
    // before the fix, targetSets stayed 3 against only 2 real sets, which
    // could never be satisfied and permanently blocked Finish Workout.
    useActiveWorkoutStore.getState().markSetCompleted('ex1', setA.id, 'db-a');
    useActiveWorkoutStore.getState().markSetCompleted('ex1', setB.id, 'db-b');

    expect(isExerciseComplete(useActiveWorkoutStore.getState().exercises[0])).toBe(true);
  });

  it('does not raise targetSets back up when the remaining count is still above it (only ever clamps down)', () => {
    seedThreeSetExercise();
    useActiveWorkoutStore.getState().addSet('ex1'); // 4 sets, targetSets still 3
    const sets = useActiveWorkoutStore.getState().exercises[0].sets;

    useActiveWorkoutStore.getState().removeSet('ex1', sets[3].id); // back to 3 sets

    expect(useActiveWorkoutStore.getState().exercises[0].sets).toHaveLength(3);
    expect(useActiveWorkoutStore.getState().exercises[0].targetSets).toBe(3);
  });

  it('removing sets one at a time down to a single set still leaves completion reachable', () => {
    seedThreeSetExercise();
    const [setA, , setC] = useActiveWorkoutStore.getState().exercises[0].sets;

    useActiveWorkoutStore.getState().removeSet('ex1', setC.id);
    const remainingAfterFirst = useActiveWorkoutStore.getState().exercises[0].sets;
    useActiveWorkoutStore.getState().removeSet('ex1', remainingAfterFirst[1].id);

    const exercise = useActiveWorkoutStore.getState().exercises[0];
    expect(exercise.sets).toHaveLength(1);
    expect(exercise.targetSets).toBe(1);

    useActiveWorkoutStore.getState().markSetCompleted('ex1', setA.id, 'db-a');
    expect(isExerciseComplete(useActiveWorkoutStore.getState().exercises[0])).toBe(true);
  });
});
