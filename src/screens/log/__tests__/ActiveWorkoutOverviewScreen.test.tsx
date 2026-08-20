import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ActiveWorkoutOverviewScreen } from '../ActiveWorkoutOverviewScreen';
import { useActiveWorkoutStore } from '../../../store/activeWorkoutStore';

const mockNavigate = jest.fn();
const mockPopToTop = jest.fn();
const mockUseRoute = jest.fn(
  (): { params: { programDayId?: string; scheduledWorkoutId?: string; variantType?: string } } => ({
    params: { programDayId: 'day-1' },
  }),
);

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, popToTop: mockPopToTop, canGoBack: () => false }),
    useRoute: () => mockUseRoute(),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

jest.mock('../../../hooks/useUnitPreference', () => ({
  useUnitPreference: () => 'kg',
}));

const PROGRAM_DAY_WITH_TARGETS = {
  id: 'day-1',
  title: 'Push Day',
  program_exercises: [
    {
      id: 'pe-1',
      exercise_id: 'ex1',
      exercises: { id: 'ex1', name: 'Bench Press' },
      target_sets: 3,
      target_reps_min: 8,
      target_reps_max: 10,
      target_load_kg: 60,
      target_rpe: 8,
      rest_seconds: 90,
    },
  ],
};

jest.mock('../../../services/api/queries/programs', () => ({
  useProgramDay: jest.fn(() => ({ data: { id: 'day-1', title: 'Push Day' }, isLoading: false })),
}));

const mockDeleteScheduledWorkoutMutate = jest.fn();

jest.mock('../../../services/api/queries/scheduledWorkouts', () => ({
  useScheduledWorkout: jest.fn(() => ({ data: undefined, isLoading: false })),
  useDeleteScheduledWorkout: jest.fn(() => ({ mutate: mockDeleteScheduledWorkoutMutate })),
}));

jest.mock('../../../services/api/queries/workoutTemplates', () => ({
  useWorkoutTemplate: jest.fn(() => ({ data: undefined, isLoading: false })),
}));

const EXERCISE_LIBRARY = [
  {
    id: 'ex1',
    name: 'Bench Press',
    category: 'push',
    primary_muscle: 'chest',
    equipment: 'barbell',
    secondary_muscles: ['triceps'],
    movement_pattern: 'push_horizontal',
    difficulty: 'intermediate',
    joint_stress: 'moderate',
    skill_requirement: 'moderate',
    instructions: null,
    demo_media_url: null,
    demo_media_type: null,
    is_custom: false,
    created_by: null,
    created_at: '',
  },
];

jest.mock('../../../services/api/queries/exercises', () => ({
  useExercises: jest.fn(() => ({ data: EXERCISE_LIBRARY, isLoading: false })),
}));

jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: jest.fn(() => ({ data: { id: 'user-1', equipment_access: ['barbell'] }, isLoading: false })),
}));

const mockStartWorkoutLogMutateAsync = jest.fn().mockResolvedValue({ id: 'wl-1' });
const mockDeleteWorkoutLogMutateAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../services/api/queries/workoutLogs', () => ({
  useStartWorkoutLog: jest.fn(() => ({ mutateAsync: mockStartWorkoutLogMutateAsync })),
  useDeleteWorkoutLog: jest.fn(() => ({ mutateAsync: mockDeleteWorkoutLogMutateAsync })),
}));

jest.mock('../../../services/api/queries/coaching', () => ({
  useWorkoutAdaptations: jest.fn(() => ({ data: [], isLoading: false })),
}));

const mockedGenerateWorkoutVariant = jest.fn();

jest.mock('../../../services/coaching', () => ({
  coachingEngine: {
    generateWorkoutVariant: (...args: unknown[]) => mockedGenerateWorkoutVariant(...args),
  },
}));

import { useProgramDay } from '../../../services/api/queries/programs';

const mockedUseProgramDay = useProgramDay as jest.Mock;

function seedActiveWorkout() {
  useActiveWorkoutStore.setState({
    workoutLogId: 'wl-1',
    source: { type: 'programDay', id: 'day-1' },
    startedAt: Date.now(),
    restSecondsRemaining: 0,
    restRunning: false,
    exercises: [
      {
        exerciseId: 'ex1',
        exerciseName: 'Bench Press',
        targetSets: 2,
        targetRepsMin: 8,
        targetRepsMax: 10,
        targetLoadKg: 60,
        targetRpe: 8,
        restSeconds: 90,
        metric: 'weight_kg',
        notes: '',
        sets: [
          { id: 'set-1', dbId: 'dbset-1', setNumber: 1, reps: 8, loadKg: 60, rpe: null, durationSeconds: null, timerStartedAt: null, isWarmup: false, completed: true },
          { id: 'set-2', dbId: null, setNumber: 2, reps: 8, loadKg: 60, rpe: null, durationSeconds: null, timerStartedAt: null, isWarmup: false, completed: false },
        ],
      },
    ],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStartWorkoutLogMutateAsync.mockResolvedValue({ id: 'wl-1' });
  mockUseRoute.mockReturnValue({ params: { programDayId: 'day-1' } });
  mockedUseProgramDay.mockReturnValue({ data: { id: 'day-1', title: 'Push Day' }, isLoading: false });
  seedActiveWorkout();
});

describe('ActiveWorkoutOverviewScreen — exercise list', () => {
  it('shows each exercise as a compact row with its set-completion progress, and opens the focused screen on tap', async () => {
    const { getByText, getByLabelText } = await render(<ActiveWorkoutOverviewScreen />);

    expect(getByText('Bench Press')).toBeTruthy();
    expect(getByText('1 of 2 sets complete')).toBeTruthy();

    await fireEvent.press(getByLabelText('Bench Press, 1 of 2 sets complete'));

    expect(mockNavigate).toHaveBeenCalledWith('ActiveExercise', { exerciseId: 'ex1' });
  });

  it('does not navigate to the summary when Finish Workout is pressed while an exercise is incomplete', async () => {
    const { getByText } = await render(<ActiveWorkoutOverviewScreen />);

    await fireEvent.press(getByText('Finish Workout'));

    expect(mockNavigate).not.toHaveBeenCalledWith('WorkoutSummary');
  });

  it('enables Finish Workout once every exercise is complete and navigates to the summary', async () => {
    useActiveWorkoutStore.setState(state => ({
      exercises: state.exercises.map(exercise => ({
        ...exercise,
        sets: exercise.sets.map(s => ({ ...s, completed: true })),
      })),
    }));

    const { getByText } = await render(<ActiveWorkoutOverviewScreen />);
    await fireEvent.press(getByText('Finish Workout'));

    expect(mockNavigate).toHaveBeenCalledWith('WorkoutSummary');
  });

  it('lets a workout be finished after a set is removed mid-way, instead of permanently blocking on the original target', async () => {
    // seedActiveWorkout's exercise has targetSets: 2, two sets (one already
    // completed). Remove the still-incomplete second set — before the fix,
    // targetSets stayed at 2 forever, so with only 1 real set left it could
    // never reach "2 completed" and Finish Workout stayed disabled no
    // matter what the athlete did.
    const secondSetId = useActiveWorkoutStore.getState().exercises[0].sets[1].id;
    useActiveWorkoutStore.getState().removeSet('ex1', secondSetId);

    const { getByText, getByLabelText } = await render(<ActiveWorkoutOverviewScreen />);
    expect(getByLabelText('Bench Press, 1 of 1 sets complete')).toBeTruthy();

    await fireEvent.press(getByText('Finish Workout'));
    expect(mockNavigate).toHaveBeenCalledWith('WorkoutSummary');
  });
});

describe('ActiveWorkoutOverviewScreen — delete workout', () => {
  it('offers Delete Workout in the options menu, confirms before deleting, and resets the session on confirm', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const deleteButton = buttons?.find(b => b.text === 'Delete');
      deleteButton?.onPress?.();
    });

    const { getByText, getByLabelText } = await render(<ActiveWorkoutOverviewScreen />);

    await fireEvent.press(getByLabelText('Workout options'));
    expect(getByText('Browse Exercise Library')).toBeTruthy();
    await fireEvent.press(getByText('Delete Workout'));

    expect(alertSpy).toHaveBeenCalled();
    await waitFor(() => expect(mockDeleteWorkoutLogMutateAsync).toHaveBeenCalledWith('wl-1'));
    expect(useActiveWorkoutStore.getState().workoutLogId).toBeNull();
    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'TodayTab', params: { screen: 'Today' } });
    expect(mockPopToTop).toHaveBeenCalled();

    // Regression: the bottom-tab navigator doesn't unmount this screen just
    // because the tab focus switched away, and the route's programDayId is
    // still present — a resetting store used to be read as "no session yet
    // for this target" and silently auto-started a brand new one.
    expect(mockStartWorkoutLogMutateAsync).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  it('does not delete the underlying scheduled workout when the session came from a recurring program day', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find(b => b.text === 'Delete')?.onPress?.();
    });

    const { getByLabelText, getByText } = await render(<ActiveWorkoutOverviewScreen />);
    await fireEvent.press(getByLabelText('Workout options'));
    await fireEvent.press(getByText('Delete Workout'));

    await waitFor(() => expect(mockDeleteWorkoutLogMutateAsync).toHaveBeenCalledWith('wl-1'));
    expect(mockDeleteScheduledWorkoutMutate).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  it('also deletes the underlying scheduled workout when the deleted session was a one-off scheduled workout', async () => {
    mockUseRoute.mockReturnValue({ params: { scheduledWorkoutId: 'sw-1' } });
    useActiveWorkoutStore.setState({ source: { type: 'scheduledWorkout', id: 'sw-1' } });

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find(b => b.text === 'Delete')?.onPress?.();
    });

    const { getByLabelText, getByText } = await render(<ActiveWorkoutOverviewScreen />);
    await fireEvent.press(getByLabelText('Workout options'));
    await fireEvent.press(getByText('Delete Workout'));

    await waitFor(() => expect(mockDeleteWorkoutLogMutateAsync).toHaveBeenCalledWith('wl-1'));
    expect(mockDeleteScheduledWorkoutMutate).toHaveBeenCalledWith('sw-1');

    alertSpy.mockRestore();
  });

  it('does not delete when the confirmation is cancelled', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByLabelText, getByText } = await render(<ActiveWorkoutOverviewScreen />);
    await fireEvent.press(getByLabelText('Workout options'));
    await fireEvent.press(getByText('Delete Workout'));

    expect(mockDeleteWorkoutLogMutateAsync).not.toHaveBeenCalled();
    expect(useActiveWorkoutStore.getState().workoutLogId).toBe('wl-1');

    alertSpy.mockRestore();
  });
});

describe('ActiveWorkoutOverviewScreen — workout variants', () => {
  const VARIANT_RESULT = {
    variantType: 'bodyweight' as const,
    label: 'Bodyweight Version',
    summary: 'Swapped every exercise for a bodyweight-only version.',
    estimatedMinutes: 20,
    exercises: [
      {
        exerciseId: 'ex2',
        exerciseName: 'Push-Up',
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 10,
        targetLoadKg: null,
        targetRpe: 8,
        restSeconds: 90,
      },
    ],
    changes: [
      {
        exerciseId: 'ex1',
        type: 'substituted' as const,
        reason: 'Same push horizontal pattern — uses bodyweight instead of barbell.',
      },
    ],
  };

  it('applies a chosen variant when starting a fresh session and shows it was applied', async () => {
    useActiveWorkoutStore.setState({
      workoutLogId: null,
      source: null,
      exercises: [],
      startedAt: null,
      restSecondsRemaining: 0,
      restRunning: false,
    });
    mockUseRoute.mockReturnValue({ params: { programDayId: 'day-1', variantType: 'bodyweight' } });
    mockedUseProgramDay.mockReturnValue({ data: PROGRAM_DAY_WITH_TARGETS, isLoading: false });
    mockedGenerateWorkoutVariant.mockReturnValue(VARIANT_RESULT);

    const { getByText } = await render(<ActiveWorkoutOverviewScreen />);

    await waitFor(() => expect(mockedGenerateWorkoutVariant).toHaveBeenCalledTimes(1));
    expect(mockedGenerateWorkoutVariant.mock.calls[0][0]).toMatchObject({ variantType: 'bodyweight' });
    expect(mockStartWorkoutLogMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ variantType: 'bodyweight' }));

    await waitFor(() => expect(getByText('Variant: Bodyweight Version — tap to view changes')).toBeTruthy());

    const state = useActiveWorkoutStore.getState();
    expect(state.exercises).toHaveLength(1);
    expect(state.exercises[0].exerciseId).toBe('ex2');
    expect(state.exercises[0].exerciseName).toBe('Push-Up');
    expect(state.exercises[0].targetLoadKg).toBeNull();
  });
});
