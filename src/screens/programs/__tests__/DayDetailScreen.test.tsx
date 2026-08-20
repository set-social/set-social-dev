import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { DayDetailScreen } from '../DayDetailScreen';

const mockNavigate = jest.fn();
let mockRouteParams: { programDayId: string; date?: string } = { programDayId: 'day-1' };

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, canGoBack: () => true }),
    useRoute: () => ({ params: mockRouteParams }),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

jest.mock('../../../services/api/queries/workoutTemplates', () => ({
  useCreateTemplateFromProgramDay: jest.fn(() => ({ mutateAsync: jest.fn() })),
}));

const mockNavigateToStartWorkout = jest.fn();
const mockNavigateToStartCardio = jest.fn();

jest.mock('../../../navigation/startWorkoutFlow', () => ({
  navigateToStartWorkout: (...args: unknown[]) => mockNavigateToStartWorkout(...args),
  navigateToChooseVariant: jest.fn(),
  navigateToStartCardio: (...args: unknown[]) => mockNavigateToStartCardio(...args),
}));

const mockBuildWorkoutSnapshot = jest.fn();

jest.mock('../../../services/api/queries/workoutShares', () => ({
  buildWorkoutSnapshot: (...args: unknown[]) => mockBuildWorkoutSnapshot(...args),
}));

const mockRemoveProgramExerciseMutate = jest.fn();
const mockSetDayTypeMutate = jest.fn();
const mockUseProgramDay = jest.fn();

jest.mock('../../../services/api/queries/programs', () => ({
  useProgramDay: (...args: unknown[]) => mockUseProgramDay(...args),
  useRemoveProgramExercise: jest.fn(() => ({ mutate: mockRemoveProgramExerciseMutate })),
  useSetDayType: jest.fn(() => ({ mutate: mockSetDayTypeMutate, isPending: false })),
}));

const TRAINING_DAY = {
  id: 'day-1',
  title: 'Push Day',
  is_rest_day: false,
  day_type: 'training',
  program_weeks: { week_number: 1, programs: { title: 'Strength Block' } },
  program_exercises: [
    {
      id: 'pe-1',
      target_sets: 3,
      target_reps_min: 8,
      target_reps_max: 10,
      target_rpe: null,
      rest_seconds: null,
      exercises: { name: 'Bench Press' },
    },
  ],
};

const REST_DAY = {
  id: 'day-1',
  title: 'Rest Day',
  is_rest_day: true,
  day_type: 'rest',
  program_weeks: { week_number: 1, programs: { title: 'Strength Block' } },
  program_exercises: [],
};

const CARDIO_DAY = {
  id: 'day-1',
  title: 'Cardio Day',
  is_rest_day: false,
  day_type: 'cardio',
  program_weeks: { week_number: 1, programs: { title: 'Strength Block' } },
  program_exercises: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseProgramDay.mockReturnValue({ data: TRAINING_DAY, isLoading: false });
  mockRouteParams = { programDayId: 'day-1' };
});

describe('DayDetailScreen', () => {
  it('navigates to ExercisePicker with programDayId when adding an exercise', async () => {
    const { getByText } = await render(<DayDetailScreen />);
    await waitFor(() => expect(getByText('Bench Press')).toBeTruthy());

    await fireEvent.press(getByText('Add Exercise'));

    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', {
      screen: 'ProgramsTab',
      params: { screen: 'ExercisePicker', params: { programDayId: 'day-1' } },
    });
  });

  it('removes an exercise after confirming', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const removeButton = buttons?.find(b => b.text === 'Remove');
      removeButton?.onPress?.();
    });

    const { getByLabelText, getByText } = await render(<DayDetailScreen />);
    await waitFor(() => expect(getByText('Bench Press')).toBeTruthy());

    await fireEvent.press(getByLabelText('Remove Bench Press'));

    expect(mockRemoveProgramExerciseMutate).toHaveBeenCalledWith({ id: 'pe-1', programDayId: 'day-1' });
    alertSpy.mockRestore();
  });

  it('offers Add Workout and Log Cardio options on a rest day instead of Add Exercise/Start Workout', async () => {
    mockUseProgramDay.mockReturnValue({ data: REST_DAY, isLoading: false });

    const { getByText, queryByText } = await render(<DayDetailScreen />);
    await waitFor(() => expect(getByText('Add Workout')).toBeTruthy());

    expect(queryByText('Add Exercise')).toBeNull();
    expect(queryByText('Start Workout')).toBeNull();
    expect(getByText('Log Cardio')).toBeTruthy();
    // "Add a Run" is the training-day action — a rest day already offers
    // Log Cardio for the whole day, so it doesn't need both.
    expect(queryByText('Add a Run')).toBeNull();

    await fireEvent.press(getByText('Add Workout'));
    expect(mockSetDayTypeMutate).toHaveBeenCalledWith({ id: 'day-1', dayType: 'training' });
  });

  it('marks the day cardio and starts a cardio session when Log Cardio is tapped from a rest day', async () => {
    mockUseProgramDay.mockReturnValue({ data: REST_DAY, isLoading: false });
    mockSetDayTypeMutate.mockImplementation((_params, options) => options?.onSuccess?.());

    const { getByText } = await render(<DayDetailScreen />);
    await waitFor(() => expect(getByText('Log Cardio')).toBeTruthy());

    await fireEvent.press(getByText('Log Cardio'));
    expect(mockSetDayTypeMutate).toHaveBeenCalledWith(
      { id: 'day-1', dayType: 'cardio' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(mockNavigateToStartCardio).toHaveBeenCalledWith(expect.anything(), { programDayId: 'day-1' });
  });

  it('shows Start Workout (not Add Workout) on a normal training day', async () => {
    const { getByText, queryByText } = await render(<DayDetailScreen />);
    await waitFor(() => expect(getByText('Start Workout')).toBeTruthy());
    expect(queryByText('Add Workout')).toBeNull();
  });

  it('greys out Start Workout and shows "Check back tomorrow!" when the viewed date is in the future', async () => {
    const { addDays, format } = jest.requireActual('date-fns');
    mockRouteParams = { programDayId: 'day-1', date: format(addDays(new Date(), 1), 'yyyy-MM-dd') };

    const { getByText } = await render(<DayDetailScreen />);
    await waitFor(() => expect(getByText('Start Workout')).toBeTruthy());

    expect(getByText('Check back tomorrow!')).toBeTruthy();
    await fireEvent.press(getByText('Start Workout'));
    expect(mockNavigateToStartWorkout).not.toHaveBeenCalled();
  });

  it('offers Start Cardio (no exercise list) on a cardio day', async () => {
    mockUseProgramDay.mockReturnValue({ data: CARDIO_DAY, isLoading: false });

    const { getByText, queryByText } = await render(<DayDetailScreen />);
    await waitFor(() => expect(getByText('Start Cardio')).toBeTruthy());

    expect(queryByText('Add Exercise')).toBeNull();
    expect(queryByText('Start Workout')).toBeNull();
    expect(queryByText('Add a Run')).toBeNull();

    await fireEvent.press(getByText('Start Cardio'));
    expect(mockNavigateToStartCardio).toHaveBeenCalledWith(expect.anything(), { programDayId: 'day-1' });
  });

  it('offers Add a Run on a training day, additive alongside Start Workout', async () => {
    const { getByText } = await render(<DayDetailScreen />);
    await waitFor(() => expect(getByText('Start Workout')).toBeTruthy());

    expect(getByText('Add a Run')).toBeTruthy();
    await fireEvent.press(getByText('Add a Run'));

    expect(mockNavigateToStartCardio).toHaveBeenCalledWith(expect.anything(), {
      programDayId: 'day-1',
      date: undefined,
    });
    // Doesn't touch the strength side of the day.
    expect(mockNavigateToStartWorkout).not.toHaveBeenCalled();
    expect(mockSetDayTypeMutate).not.toHaveBeenCalled();
  });

  it('passes the viewed date to Add a Run when browsing a specific day', async () => {
    const { format } = jest.requireActual('date-fns');
    const todayKey = format(new Date(), 'yyyy-MM-dd');
    mockRouteParams = { programDayId: 'day-1', date: todayKey };
    const { getByText } = await render(<DayDetailScreen />);
    await waitFor(() => expect(getByText('Add a Run')).toBeTruthy());

    await fireEvent.press(getByText('Add a Run'));
    expect(mockNavigateToStartCardio).toHaveBeenCalledWith(expect.anything(), {
      programDayId: 'day-1',
      date: todayKey,
    });
  });

  it('disables Add a Run for a future day, same as Start Workout', async () => {
    const { addDays, format } = jest.requireActual('date-fns');
    mockRouteParams = { programDayId: 'day-1', date: format(addDays(new Date(), 1), 'yyyy-MM-dd') };

    const { getByText } = await render(<DayDetailScreen />);
    await waitFor(() => expect(getByText('Add a Run')).toBeTruthy());

    await fireEvent.press(getByText('Add a Run'));
    expect(mockNavigateToStartCardio).not.toHaveBeenCalled();
  });

  it('shares this training day and navigates to ShareWorkout', async () => {
    const snapshot = { name: 'Push Day', notes: null, estimatedDurationMinutes: null, exercises: [] };
    mockBuildWorkoutSnapshot.mockResolvedValue(snapshot);

    const { getByLabelText, getByText } = await render(<DayDetailScreen />);
    await waitFor(() => expect(getByText('Bench Press')).toBeTruthy());

    await fireEvent.press(getByLabelText('Share this workout'));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('MainTabs', {
        screen: 'ProgramsTab',
        params: {
          screen: 'ShareWorkout',
          params: { shareType: 'single_workout', title: 'Push Day', payload: { workout: snapshot } },
        },
      }),
    );
    expect(mockBuildWorkoutSnapshot).toHaveBeenCalledWith(
      { name: 'Push Day', notes: null, estimatedDurationMinutes: null },
      TRAINING_DAY.program_exercises,
    );
  });

  it('has no Share button on a rest or cardio day (nothing to share)', async () => {
    mockUseProgramDay.mockReturnValue({ data: REST_DAY, isLoading: false });
    const { queryByLabelText, getByText } = await render(<DayDetailScreen />);
    await waitFor(() => expect(getByText('Add Workout')).toBeTruthy());
    expect(queryByLabelText('Share this workout')).toBeNull();
  });
});
