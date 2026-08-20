import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CardioActivityKey } from '../utils/cardioCalories';
import type { RoutePoint } from '../utils/routeMetrics';

/** What a live cardio session was started from — mirrors
 * activeWorkoutStore's WorkoutSource shape/reasoning: determines which
 * program day (if any) the eventual cardio_log_entries row should be
 * associated with. */
export type CardioSessionSource = { programDayId: string | null; date?: string };

export type CardioSessionStatus = 'idle' | 'tracking' | 'paused' | 'finished';

type ActiveCardioState = {
  status: CardioSessionStatus;
  source: CardioSessionSource | null;
  activityKey: CardioActivityKey | null;
  exerciseId: string | null;
  customActivityName: string | null;
  /** Wall-clock timestamp the session started at — elapsed time is always
   * recomputed from this plus `pausedMs` rather than decremented, same
   * reasoning as activeWorkoutStore's restEndsAt: immune to JS timers being
   * suspended while the screen is backgrounded. */
  startedAt: number | null;
  /** Wall-clock timestamp the current pause began, or null when not
   * currently paused. */
  pausedAt: number | null;
  /** Total time spent paused so far, accumulated each time a pause ends —
   * elapsed = (now - startedAt) - pausedMs - (pausedAt ? now - pausedAt : 0). */
  pausedMs: number;
  /** Wall-clock timestamp Finish was tapped — once set, elapsed time is
   * frozen as of this moment rather than still counting up against
   * Date.now(), so CardioRunSummaryScreen shows a fixed duration instead
   * of one that keeps ticking while the user reviews splits and saves. */
  finishedAt: number | null;
  points: RoutePoint[];
  /** False until the persisted session (if any) has been read back from
   * AsyncStorage — same guard activeWorkoutStore uses before any screen
   * trusts `status`/`points` on cold start. */
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;

  startSession: (params: {
    source: CardioSessionSource;
    activityKey: CardioActivityKey;
    exerciseId: string | null;
    customActivityName: string | null;
  }) => void;
  addPoint: (point: RoutePoint) => void;
  pauseSession: () => void;
  resumeSession: () => void;
  finishSession: () => void;
  discardSession: () => void;
  reset: () => void;
};

const initialState = {
  status: 'idle',
  source: null,
  activityKey: null,
  exerciseId: null,
  customActivityName: null,
  startedAt: null,
  pausedAt: null,
  pausedMs: 0,
  finishedAt: null,
  points: [],
} satisfies Partial<ActiveCardioState>;

export const useActiveCardioStore = create<ActiveCardioState>()(
  persist(
    set => ({
      ...initialState,
      hasHydrated: false,
      setHasHydrated: value => set({ hasHydrated: value }),

      startSession: ({ source, activityKey, exerciseId, customActivityName }) =>
        set({
          status: 'tracking',
          source,
          activityKey,
          exerciseId,
          customActivityName,
          startedAt: Date.now(),
          pausedAt: null,
          pausedMs: 0,
          finishedAt: null,
          points: [],
        }),

      // No-ops while paused/idle/finished — a location callback that fires
      // right as a pause is requested (there's no way to atomically cancel
      // an in-flight native callback) must not silently resume recording.
      addPoint: point =>
        set(state => (state.status !== 'tracking' ? state : { points: [...state.points, point] })),

      pauseSession: () =>
        set(state => (state.status !== 'tracking' ? state : { status: 'paused', pausedAt: Date.now() })),

      resumeSession: () =>
        set(state => {
          if (state.status !== 'paused' || state.pausedAt == null) return state;
          return {
            status: 'tracking',
            pausedAt: null,
            pausedMs: state.pausedMs + (Date.now() - state.pausedAt),
          };
        }),

      finishSession: () =>
        set(state => ({
          status: 'finished',
          // A finish while paused folds the open pause into pausedMs first,
          // same accounting resumeSession does — otherwise the paused
          // stretch between the last pause and Finish would count as
          // recorded time.
          pausedAt: null,
          pausedMs: state.pausedMs + (state.pausedAt != null ? Date.now() - state.pausedAt : 0),
          finishedAt: Date.now(),
        })),

      discardSession: () => set(initialState),

      reset: () => set(initialState),
    }),
    {
      name: 'active-cardio-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({
        status: state.status,
        source: state.source,
        activityKey: state.activityKey,
        exerciseId: state.exerciseId,
        customActivityName: state.customActivityName,
        startedAt: state.startedAt,
        pausedAt: state.pausedAt,
        pausedMs: state.pausedMs,
        finishedAt: state.finishedAt,
        points: state.points,
      }),
      onRehydrateStorage: () => state => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

/** No real single cardio session plausibly runs this long. A persisted
 * `status` other than 'idle' whose `startedAt` is older than this is an
 * abandoned session — the app crashed/was force-quit mid-run (leaving
 * 'tracking'/'paused' stuck), or a save on CardioRunSummaryScreen failed and
 * the athlete backed out without retrying or discarding (leaving 'finished'
 * stuck, since onSave only resets the store on success) — not one still
 * legitimately in progress. See LiveCardioTrackingScreen's mount effect,
 * which treats a session matching this as abandoned rather than resuming it
 * (the bug this constant exists to fix: starting a brand new run would
 * otherwise silently inherit a leftover session's ancient startedAt,
 * showing an already-enormous duration/pace from the first tick). */
export const MAX_PLAUSIBLE_CARDIO_SESSION_MS = 6 * 60 * 60 * 1000;

/** Elapsed *recording* time in seconds — excludes time spent paused. Pure
 * function over the store's own shape (not a hook) so it can be called from
 * both a React component (via useActiveCardioStore selectors) and a plain
 * setInterval tick without depending on hook rules. Once `finishedAt` is
 * set, elapsed is frozen as of that moment rather than still counting
 * against the current wall clock — see the field's own doc comment. */
export function computeElapsedSeconds(
  state: Pick<ActiveCardioState, 'startedAt' | 'pausedAt' | 'pausedMs' | 'finishedAt'>,
): number {
  if (state.startedAt == null) return 0;
  const now = state.finishedAt ?? Date.now();
  const pausedMs = state.pausedMs + (state.pausedAt != null ? now - state.pausedAt : 0);
  return Math.max(0, (now - state.startedAt - pausedMs) / 1000);
}
