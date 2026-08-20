import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { addDays, format } from 'date-fns';
import { ScheduledWorkoutDetailScreen } from '../ScheduledWorkoutDetailScreen';
import { useScheduledWorkout } from '../../../services/api/queries/scheduledWorkouts';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, canGoBack: () => true }),
    useRoute: () => ({ params: { scheduledWorkoutId: 'sw-1' } }),
  };
});

const mockNavigateToStartWorkout = jest.fn();

jest.mock('../../../navigation/startWorkoutFlow', () => ({
  navigateToStartWorkout: (...args: unknown[]) => mockNavigateToStartWorkout(...args),
  navigateToChooseVariant: jest.fn(),
}));

const mockBuildWorkoutSnapshot = jest.fn();

jest.mock('../../../services/api/queries/workoutShares', () => ({
  buildWorkoutSnapshot: (...args: unknown[]) => mockBuildWorkoutSnapshot(...args),
}));

const mockDeleteScheduledWorkoutMutateAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../services/api/queries/scheduledWorkouts', () => ({
  useScheduledWorkout: jest.fn(() => ({
    data: {
      id: 'sw-1',
      name: 'Test Workout',
      scheduled_date: '2026-01-01',
      scheduled_workout_exercises: [
        {
          id: 'se-1',
          target_sets: 3,
          target_reps_min: 8,
          target_reps_max: 10,
          target_rpe: null,
          rest_seconds: 60,
          exercises: { name: 'Bench Press' },
        },
      ],
    },
    isLoading: false,
  })),
  useDeleteScheduledWorkout: jest.fn(() => ({ mutateAsync: mockDeleteScheduledWorkoutMutateAsync })),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ScheduledWorkoutDetailScreen', () => {
  it('deletes the scheduled workout after confirming, and goes back', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const deleteButton = buttons?.find(b => b.text === 'Delete');
      deleteButton?.onPress?.();
    });

    const { getByLabelText, getByText } = await render(<ScheduledWorkoutDetailScreen />);
    await waitFor(() => expect(getByText('Test Workout')).toBeTruthy());

    await fireEvent.press(getByLabelText('Delete workout'));

    expect(alertSpy).toHaveBeenCalled();
    await waitFor(() => expect(mockDeleteScheduledWorkoutMutateAsync).toHaveBeenCalledWith('sw-1'));
    expect(mockGoBack).toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  it('does not delete when the confirmation is cancelled', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByLabelText, getByText } = await render(<ScheduledWorkoutDetailScreen />);
    await waitFor(() => expect(getByText('Test Workout')).toBeTruthy());

    await fireEvent.press(getByLabelText('Delete workout'));

    expect(mockDeleteScheduledWorkoutMutateAsync).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  it('shares this scheduled workout and navigates to ShareWorkout', async () => {
    const snapshot = { name: 'Test Workout', notes: null, estimatedDurationMinutes: null, exercises: [] };
    mockBuildWorkoutSnapshot.mockResolvedValue(snapshot);

    const { getByLabelText, getByText } = await render(<ScheduledWorkoutDetailScreen />);
    await waitFor(() => expect(getByText('Test Workout')).toBeTruthy());

    await fireEvent.press(getByLabelText('Share this workout'));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('MainTabs', {
        screen: 'ProgramsTab',
        params: {
          screen: 'ShareWorkout',
          params: { shareType: 'single_workout', title: 'Test Workout', payload: { workout: snapshot } },
        },
      }),
    );
  });

  it('greys out Start Workout and shows "Check back tomorrow!" for a future scheduled date', async () => {
    (useScheduledWorkout as jest.Mock).mockReturnValueOnce({
      data: {
        id: 'sw-1',
        name: 'Test Workout',
        scheduled_date: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
        scheduled_workout_exercises: [],
      },
      isLoading: false,
    });

    const { getByText } = await render(<ScheduledWorkoutDetailScreen />);
    await waitFor(() => expect(getByText('Test Workout')).toBeTruthy());

    expect(getByText('Check back tomorrow!')).toBeTruthy();
    await fireEvent.press(getByText('Start Workout'));
    expect(mockNavigateToStartWorkout).not.toHaveBeenCalled();
  });
});
