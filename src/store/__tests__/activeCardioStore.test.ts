import { useActiveCardioStore, computeElapsedSeconds } from '../activeCardioStore';

const SOURCE = { programDayId: 'day-1' };

function startSession() {
  useActiveCardioStore.getState().startSession({
    source: SOURCE,
    activityKey: 'run',
    exerciseId: 'ex-run',
    customActivityName: null,
  });
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(0);
  useActiveCardioStore.getState().reset();
});

afterEach(() => {
  useActiveCardioStore.getState().reset();
  jest.useRealTimers();
});

describe('activeCardioStore session lifecycle', () => {
  it('starts idle', () => {
    expect(useActiveCardioStore.getState().status).toBe('idle');
  });

  it('startSession moves to tracking and records the source/activity', () => {
    startSession();
    const state = useActiveCardioStore.getState();
    expect(state.status).toBe('tracking');
    expect(state.source).toEqual(SOURCE);
    expect(state.activityKey).toBe('run');
    expect(state.exerciseId).toBe('ex-run');
    expect(state.points).toEqual([]);
  });

  it('addPoint appends while tracking', () => {
    startSession();
    const point = { latitude: 1, longitude: 2, recordedAt: 1000 };
    useActiveCardioStore.getState().addPoint(point);
    expect(useActiveCardioStore.getState().points).toEqual([point]);
  });

  it('addPoint is a no-op while paused', () => {
    startSession();
    useActiveCardioStore.getState().pauseSession();
    useActiveCardioStore.getState().addPoint({ latitude: 1, longitude: 2, recordedAt: 1000 });
    expect(useActiveCardioStore.getState().points).toEqual([]);
  });

  it('addPoint is a no-op when idle (no session started)', () => {
    useActiveCardioStore.getState().addPoint({ latitude: 1, longitude: 2, recordedAt: 1000 });
    expect(useActiveCardioStore.getState().points).toEqual([]);
  });

  it('pauseSession only transitions from tracking', () => {
    // idle -> pause is a no-op
    useActiveCardioStore.getState().pauseSession();
    expect(useActiveCardioStore.getState().status).toBe('idle');

    startSession();
    useActiveCardioStore.getState().pauseSession();
    expect(useActiveCardioStore.getState().status).toBe('paused');
  });

  it('resumeSession only transitions from paused', () => {
    startSession();
    useActiveCardioStore.getState().resumeSession();
    expect(useActiveCardioStore.getState().status).toBe('tracking');

    useActiveCardioStore.getState().pauseSession();
    useActiveCardioStore.getState().resumeSession();
    expect(useActiveCardioStore.getState().status).toBe('tracking');
    expect(useActiveCardioStore.getState().pausedAt).toBeNull();
  });

  it('finishSession moves to finished', () => {
    startSession();
    useActiveCardioStore.getState().finishSession();
    expect(useActiveCardioStore.getState().status).toBe('finished');
  });

  it('discardSession/reset both clear back to idle with empty points', () => {
    startSession();
    useActiveCardioStore.getState().addPoint({ latitude: 1, longitude: 2, recordedAt: 1000 });
    useActiveCardioStore.getState().discardSession();
    const state = useActiveCardioStore.getState();
    expect(state.status).toBe('idle');
    expect(state.points).toEqual([]);
    expect(state.source).toBeNull();
  });
});

describe('computeElapsedSeconds', () => {
  it('is 0 before a session starts', () => {
    expect(computeElapsedSeconds(useActiveCardioStore.getState())).toBe(0);
  });

  it('recomputes from wall-clock time, not a decrementing counter', () => {
    startSession();
    jest.setSystemTime(10_000);
    expect(computeElapsedSeconds(useActiveCardioStore.getState())).toBe(10);
  });

  it('excludes time spent paused', () => {
    startSession();
    jest.setSystemTime(5_000);
    useActiveCardioStore.getState().pauseSession();
    jest.setSystemTime(15_000);
    useActiveCardioStore.getState().resumeSession();
    jest.setSystemTime(20_000);
    // 5s recorded + 5s recorded = 10s, minus the 10s pause excluded already
    // by resumeSession folding pausedAt into pausedMs.
    expect(computeElapsedSeconds(useActiveCardioStore.getState())).toBe(10);
  });

  it('excludes an in-progress pause even before resuming', () => {
    startSession();
    jest.setSystemTime(5_000);
    useActiveCardioStore.getState().pauseSession();
    jest.setSystemTime(15_000);
    // Still paused — the 10s gap since pausing must not count as elapsed.
    expect(computeElapsedSeconds(useActiveCardioStore.getState())).toBe(5);
  });

  it('freezes once finished, instead of continuing to count against the wall clock', () => {
    startSession();
    jest.setSystemTime(12_000);
    useActiveCardioStore.getState().finishSession();
    jest.setSystemTime(60_000);
    expect(computeElapsedSeconds(useActiveCardioStore.getState())).toBe(12);
  });
});
