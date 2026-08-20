import { AppState } from 'react-native';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRestTimerPreferenceStore } from './restTimerPreferenceStore';

export type LoggedSet = {
  /** Stable local key, independent of persistence state. */
  id: string;
  /** Set once this row has been saved to workout_log_sets. */
  dbId: string | null;
  setNumber: number;
  reps: number | null;
  loadKg: number | null;
  rpe: number | null;
  /** Only meaningful when the exercise's metric is 'time'. */
  durationSeconds: number | null;
  /** Timestamp this row's stopwatch was started, if it's currently running —
   * elapsed is recomputed from this on every render rather than decremented,
   * so a re-render timer here can't fall prey to the double-tick bug class
   * fixed for the rest timer (see activeWorkoutStore's restIntervalId). */
  timerStartedAt: number | null;
  isWarmup: boolean;
  completed: boolean;
};

/** Which metric the weight column tracks for a given exercise this session.
 * Only weight_lb <-> weight_kg convert the underlying value; the rest just
 * relabel the column going forward (see setExerciseMetric). Ephemeral —
 * never persisted, re-derived from the global unit preference each start. */
export type SetMetric = 'weight_lb' | 'weight_kg' | 'weight_pct' | 'reps' | 'time';

export type ActiveExercise = {
  exerciseId: string;
  exerciseName: string;
  targetSets?: number;
  targetRepsMin?: number | null;
  targetRepsMax?: number | null;
  targetLoadKg?: number | null;
  targetRpe?: number | null;
  restSeconds?: number | null;
  metric: SetMetric;
  notes: string;
  sets: LoggedSet[];
};

/** What an active workout was started from — determines where its exercises
 * are sourced from and what workout_logs FK (if any) gets set. */
export type WorkoutSource =
  | { type: 'programDay'; id: string }
  | { type: 'scheduledWorkout'; id: string }
  | { type: 'template'; id: string }
  | { type: 'freestyle'; id: null };

type ExerciseTargets = Pick<
  ActiveExercise,
  'targetSets' | 'targetRepsMin' | 'targetLoadKg' | 'targetRpe'
>;

/** One draft row per targeted set, prefilled from the program's targets so the user can just confirm or edit. */
function buildDraftSets(exercise: ExerciseTargets): LoggedSet[] {
  const count = exercise.targetSets ?? 1;
  return Array.from({ length: count }, (_, i) => ({
    id: `draft-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
    dbId: null,
    setNumber: i + 1,
    reps: exercise.targetRepsMin ?? null,
    loadKg: exercise.targetLoadKg ?? null,
    rpe: exercise.targetRpe ?? null,
    durationSeconds: null,
    timerStartedAt: null,
    isWarmup: false,
    completed: false,
  }));
}

/** A target's set count is met once that many sets are checked off; extra/short sets are handled gracefully. */
export function isExerciseComplete(exercise: ActiveExercise): boolean {
  if (exercise.sets.length === 0) return false;
  const required = exercise.targetSets ?? exercise.sets.length;
  return exercise.sets.filter(s => s.completed).length >= required;
}

/** "Total sets" for display purposes — the target, unless the athlete has
 * manually added more sets than that (addSet has no upper bound), in which
 * case the actual row count wins so a "4 of 3 complete" reading never shows. */
export function effectiveTotalSets(exercise: Pick<ActiveExercise, 'targetSets' | 'sets'>): number {
  return Math.max(exercise.targetSets ?? exercise.sets.length, exercise.sets.length);
}

export type WorkoutStats = {
  totalExercises: number;
  completedExercises: number;
  totalSets: number;
  totalReps: number;
  totalVolumeKg: number;
};

export function computeWorkoutStats(exercises: ActiveExercise[]): WorkoutStats {
  const completedSets = exercises.flatMap(e => e.sets).filter(s => s.completed);
  return {
    totalExercises: exercises.length,
    completedExercises: exercises.filter(isExerciseComplete).length,
    totalSets: completedSets.length,
    totalReps: completedSets.reduce((sum, s) => sum + (s.reps ?? 0), 0),
    totalVolumeKg: completedSets.reduce((sum, s) => sum + (s.reps ?? 0) * (s.loadKg ?? 0), 0),
  };
}

type ActiveWorkoutState = {
  workoutLogId: string | null;
  source: WorkoutSource | null;
  exercises: ActiveExercise[];
  startedAt: number | null;
  /** Wall-clock timestamp the current rest period ends at, or null when
   * none is running — restSecondsRemaining is always recomputed from this
   * (Date.now() vs. restEndsAt) rather than decremented, the same
   * timestamp-based approach LoggedSet.timerStartedAt already uses, so a
   * suspended interval (app backgrounded, or just a slow JS thread) can't
   * cause it to lose wall-clock time — the very next tick recomputes the
   * true remaining time instead of continuing from a stale count. */
  restEndsAt: number | null;
  restSecondsRemaining: number;
  restRunning: boolean;
  /** False until the persisted session (if any) has been read back from
   * AsyncStorage — screens that decide whether to resume an in-progress
   * workout (see CalendarScreen's resume banner) must wait for this before
   * checking workoutLogId, or a cold start would briefly see "no active
   * workout" and navigate somewhere it shouldn't. */
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  /** Exercises the athlete has dismissed an Arnold set recommendation for —
   * no further recommendations are offered for that exercise for the rest
   * of this workout (see ActiveExerciseScreen's onRespondToRecommendation).
   * Lives here rather than local screen state so it survives navigating
   * away and back to the exercise, and persists across an app restart the
   * same way the rest of an in-progress workout does. */
  ignoredRecommendationExerciseIds: string[];
  ignoreRecommendationsForExercise: (exerciseId: string) => void;

  startWorkout: (params: {
    workoutLogId: string;
    source: WorkoutSource;
    exercises: Array<Omit<ActiveExercise, 'sets' | 'notes' | 'metric'> & { metric?: SetMetric }>;
  }) => void;
  addExercise: (
    exercise: Omit<ActiveExercise, 'sets' | 'notes' | 'metric'> & { metric?: SetMetric },
  ) => void;
  removeExercise: (exerciseId: string) => void;
  /** Replaces the exercise list with the same exercises in a new order —
   * from the Active Workout overview's drag-to-reorder. Takes the full
   * reordered array (rather than a from/to index pair) since that's what
   * the drag list hands back on drop. */
  reorderExercises: (exercises: ActiveExercise[]) => void;
  addSet: (exerciseId: string) => void;
  updateSetDraft: (
    exerciseId: string,
    setId: string,
    patch: Partial<Pick<LoggedSet, 'reps' | 'loadKg' | 'rpe' | 'durationSeconds'>>,
  ) => void;
  markSetCompleted: (exerciseId: string, setId: string, dbId: string) => void;
  markSetIncomplete: (exerciseId: string, setId: string) => void;
  removeSet: (exerciseId: string, setId: string) => void;
  setExerciseNotes: (exerciseId: string, notes: string) => void;
  setExerciseMetric: (exerciseId: string, metric: SetMetric) => void;
  setExerciseTargetSets: (exerciseId: string, targetSets: number) => void;
  substituteExercise: (exerciseId: string, next: { exerciseId: string; exerciseName: string }) => void;
  startRestTimer: (seconds: number) => void;
  tickRestTimer: () => void;
  skipRestTimer: () => void;
  /** Starts a set's held-time stopwatch. Only one set's stopwatch can run at
   * a time (you're only doing one set right now) — starting another clears
   * whichever one was already running, discarding its unstopped elapsed
   * time rather than silently keeping two running concurrently. */
  startSetTimer: (exerciseId: string, setId: string) => void;
  /** Stops the given set's stopwatch and records its elapsed duration. */
  stopSetTimer: (exerciseId: string, setId: string) => void;
  reset: () => void;
};

const initialState = {
  workoutLogId: null,
  source: null,
  exercises: [],
  startedAt: null,
  restEndsAt: null,
  restSecondsRemaining: 0,
  restRunning: false,
  ignoredRecommendationExerciseIds: [],
} satisfies Partial<ActiveWorkoutState>;

/** Owns the rest-timer's single setInterval outside of React entirely — a
 * component-owned interval (the previous design) can't guarantee it's ever
 * mounted exactly once (screen remounts, react-native-screens retaining
 * background screens, Fast Refresh), and two concurrent intervals both
 * ticking the same counter is exactly what "counts down in twos" looks
 * like. A module-level id, always cleared before a new one starts, makes
 * that class of bug impossible regardless of component lifecycle. */
let restIntervalId: ReturnType<typeof setInterval> | null = null;

function clearRestInterval() {
  if (restIntervalId != null) {
    clearInterval(restIntervalId);
    restIntervalId = null;
  }
}

export const useActiveWorkoutStore = create<ActiveWorkoutState>()(
  persist(
    (set, get) => ({
      ...initialState,
      hasHydrated: false,
      setHasHydrated: value => set({ hasHydrated: value }),
      ignoreRecommendationsForExercise: exerciseId =>
        set(state =>
          state.ignoredRecommendationExerciseIds.includes(exerciseId)
            ? state
            : { ignoredRecommendationExerciseIds: [...state.ignoredRecommendationExerciseIds, exerciseId] },
        ),

      startWorkout: ({ workoutLogId, source, exercises }) => {
        // Defensive: a prior session's rest timer should never still be running
        // by the time a new one starts (normally reset()/skipRestTimer() have
        // already cleared it, but this guards an abandoned-without-resetting
        // session from leaving a stray interval ticking indefinitely).
        clearRestInterval();
        set({
          workoutLogId,
          source,
          exercises: exercises.map(e => ({
            ...e,
            metric: e.metric ?? 'weight_kg',
            notes: '',
            sets: buildDraftSets(e),
          })),
          startedAt: Date.now(),
          restEndsAt: null,
          restSecondsRemaining: 0,
          restRunning: false,
          ignoredRecommendationExerciseIds: [],
        });
      },

      addExercise: exercise =>
        set(state => {
          if (state.exercises.some(e => e.exerciseId === exercise.exerciseId)) return state;
          return {
            exercises: [
              ...state.exercises,
              { ...exercise, metric: exercise.metric ?? 'weight_kg', notes: '', sets: buildDraftSets(exercise) },
            ],
          };
        }),

      removeExercise: exerciseId =>
        set(state => ({
          exercises: state.exercises.filter(exercise => exercise.exerciseId !== exerciseId),
        })),

      reorderExercises: exercises => set({ exercises }),

      addSet: exerciseId =>
        set(state => ({
          exercises: state.exercises.map(exercise => {
            if (exercise.exerciseId !== exerciseId) return exercise;
            const draft = buildDraftSets({
              targetSets: 1,
              targetRepsMin: exercise.targetRepsMin,
              targetLoadKg: exercise.targetLoadKg,
              targetRpe: exercise.targetRpe,
            })[0];
            draft.setNumber = exercise.sets.length + 1;
            return { ...exercise, sets: [...exercise.sets, draft] };
          }),
        })),

      updateSetDraft: (exerciseId, setId, patch) =>
        set(state => ({
          exercises: state.exercises.map(exercise =>
            exercise.exerciseId === exerciseId
              ? { ...exercise, sets: exercise.sets.map(s => (s.id === setId ? { ...s, ...patch } : s)) }
              : exercise,
          ),
        })),

      markSetCompleted: (exerciseId, setId, dbId) =>
        set(state => ({
          exercises: state.exercises.map(exercise =>
            exercise.exerciseId === exerciseId
              ? {
                  ...exercise,
                  sets: exercise.sets.map(s => (s.id === setId ? { ...s, completed: true, dbId } : s)),
                }
              : exercise,
          ),
        })),

      markSetIncomplete: (exerciseId, setId) =>
        set(state => ({
          exercises: state.exercises.map(exercise =>
            exercise.exerciseId === exerciseId
              ? { ...exercise, sets: exercise.sets.map(s => (s.id === setId ? { ...s, completed: false } : s)) }
              : exercise,
          ),
        })),

      // Clamps targetSets down to the new count whenever removal drops below
      // it — otherwise isExerciseComplete keeps requiring the *original*
      // target (e.g. 3) against however many sets are actually left (e.g.
      // 2), which can never be satisfied, permanently disabling Finish
      // Workout for an exercise the athlete deliberately cut short. Mirrors
      // setExerciseTargetSets's same clamp for the "stop_exercise"
      // recommendation path — this is the same fix, just reachable from a
      // manual delete instead of an accepted AI recommendation.
      removeSet: (exerciseId, setId) =>
        set(state => ({
          exercises: state.exercises.map(exercise => {
            if (exercise.exerciseId !== exerciseId) return exercise;
            const sets = exercise.sets.filter(s => s.id !== setId);
            const targetSets =
              exercise.targetSets != null && sets.length < exercise.targetSets
                ? sets.length
                : exercise.targetSets;
            return { ...exercise, sets, targetSets };
          }),
        })),

      setExerciseNotes: (exerciseId, notes) =>
        set(state => ({
          exercises: state.exercises.map(exercise =>
            exercise.exerciseId === exerciseId ? { ...exercise, notes } : exercise,
          ),
        })),

      setExerciseMetric: (exerciseId, metric) =>
        set(state => ({
          exercises: state.exercises.map(exercise =>
            exercise.exerciseId === exerciseId ? { ...exercise, metric } : exercise,
          ),
        })),

      /** Caps the exercise's required-set count at what was actually done —
       * used when a "stop this exercise" recommendation is accepted, so
       * isExerciseComplete stops expecting the originally-planned set count. */
      setExerciseTargetSets: (exerciseId, targetSets) =>
        set(state => ({
          exercises: state.exercises.map(exercise =>
            exercise.exerciseId === exerciseId ? { ...exercise, targetSets } : exercise,
          ),
        })),

      /** Swaps the exercise's identity in place, keeping its targets (sets/reps/
       * RPE/rest carry over — the substitute wasn't independently programmed, so
       * approximate difficulty/progression is preserved) except target load,
       * which doesn't meaningfully transfer to a different movement/equipment.
       * Only ever called from a UI path already guarded to zero completed sets —
       * swapping after sets are logged would orphan those workout_log_sets rows. */
      substituteExercise: (exerciseId, next) =>
        set(state => ({
          exercises: state.exercises.map(exercise => {
            if (exercise.exerciseId !== exerciseId) return exercise;
            const updated: ActiveExercise = {
              ...exercise,
              exerciseId: next.exerciseId,
              exerciseName: next.exerciseName,
              targetLoadKg: null,
            };
            return { ...updated, sets: buildDraftSets(updated) };
          }),
        })),

      startRestTimer: seconds => {
        clearRestInterval();
        // Rest timer can be turned off entirely from Settings — guarded
        // once here rather than at each of the three call sites (auto-start
        // after a set, an accepted "increase rest" AI recommendation, and
        // RestTimerBanner's manual presets), so all of them are covered by
        // one check.
        if (!useRestTimerPreferenceStore.getState().restTimerEnabled || seconds <= 0) {
          set({ restEndsAt: null, restSecondsRemaining: 0, restRunning: false });
          return;
        }
        set({ restEndsAt: Date.now() + seconds * 1000, restSecondsRemaining: seconds, restRunning: true });
        restIntervalId = setInterval(() => get().tickRestTimer(), 1000);
      },

      tickRestTimer: () => {
        const endsAt = get().restEndsAt;
        if (endsAt == null) {
          // Also reached by the AppState foreground listener firing with no
          // timer actually running — a safe no-op, just tidies up any stray
          // interval rather than assuming one exists.
          clearRestInterval();
          return;
        }
        const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
        if (remaining <= 0) {
          clearRestInterval();
          set({ restEndsAt: null, restSecondsRemaining: 0, restRunning: false });
        } else {
          set({ restSecondsRemaining: remaining });
        }
      },

      skipRestTimer: () => {
        clearRestInterval();
        set({ restEndsAt: null, restSecondsRemaining: 0, restRunning: false });
      },

      startSetTimer: (exerciseId, setId) =>
        set(state => ({
          exercises: state.exercises.map(exercise => ({
            ...exercise,
            sets: exercise.sets.map(s => {
              if (exercise.exerciseId === exerciseId && s.id === setId) {
                return { ...s, timerStartedAt: Date.now() };
              }
              // Clears any other row's running stopwatch — only one runs at a time.
              return s.timerStartedAt != null ? { ...s, timerStartedAt: null } : s;
            }),
          })),
        })),

      stopSetTimer: (exerciseId, setId) =>
        set(state => ({
          exercises: state.exercises.map(exercise => {
            if (exercise.exerciseId !== exerciseId) return exercise;
            return {
              ...exercise,
              sets: exercise.sets.map(s => {
                if (s.id !== setId || s.timerStartedAt == null) return s;
                const durationSeconds = Math.round((Date.now() - s.timerStartedAt) / 1000);
                return { ...s, durationSeconds, timerStartedAt: null };
              }),
            };
          }),
        })),

      reset: () => {
        clearRestInterval();
        set(initialState);
      },
    }),
    {
      name: 'active-workout-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // Rest-timer state (including restEndsAt, timestamp-based though it
      // now is — see its own comment above) stays out of persistence
      // deliberately: unlike startedAt, which every consumer recomputes
      // against on its own, a restored restEndsAt would sit un-ticked until
      // the next startRestTimer call or foreground event, with nothing
      // actively re-rendering the banner in the meantime after a full app
      // kill (as opposed to just backgrounding, which the module-level
      // interval + AppState listener below already handle correctly without
      // needing persistence at all). Left out entirely so a fresh app
      // process always starts with no rest timer running, matching what
      // startRestTimer/reset already produce by default.
      partialize: state => ({
        workoutLogId: state.workoutLogId,
        source: state.source,
        exercises: state.exercises,
        startedAt: state.startedAt,
        ignoredRecommendationExerciseIds: state.ignoredRecommendationExerciseIds,
      }),
      onRehydrateStorage: () => state => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

// Resyncs the rest-timer display the instant the app returns to the
// foreground, rather than waiting up to 1s for the next natural tick — RN
// suspends JS timer callbacks while backgrounded, so without this the
// countdown would sit visibly frozen for a beat after resuming even though
// tickRestTimer's own timestamp math is already correct as of the very next
// call. Module-level (not owned by any component), matching restIntervalId
// above, so it's active regardless of which screen happens to be mounted —
// same "belt and suspenders" foreground-resync idea as IntegrationsScreen's
// own AppState listener, applied globally instead of screen-locally since
// the active workout can be resting while any tab is focused.
AppState.addEventListener('change', nextState => {
  if (nextState === 'active') {
    useActiveWorkoutStore.getState().tickRestTimer();
  }
});
