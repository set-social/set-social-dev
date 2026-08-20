import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { format, addDays, startOfWeek } from 'date-fns';
import { TrainingDayDetailScreen } from '../TrainingDayDetailScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: { weeklyScheduleId: string; workoutTemplateId: string; dayOfWeek: number } = {
  weeklyScheduleId: 'ws-1',
  workoutTemplateId: 'template-1',
  dayOfWeek: 3,
};

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, canGoBack: () => true }),
    useRoute: () => ({ params: mockRouteParams }),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUseWorkoutTemplate = jest.fn();

jest.mock('../../../services/api/queries/workoutTemplates', () => ({
  useWorkoutTemplate: (...args: unknown[]) => mockUseWorkoutTemplate(...args),
}));

const mockRemoveMutateAsync = jest.fn();

jest.mock('../../../services/api/queries/weeklySchedule', () => ({
  useRemoveWeeklySchedule: jest.fn(() => ({ mutateAsync: mockRemoveMutateAsync, isPending: false })),
}));

const mockStartTemplateTodayMutateAsync = jest.fn();

jest.mock('../../../services/api/queries/scheduledWorkouts', () => ({
  useStartTemplateToday: jest.fn(() => ({ mutateAsync: mockStartTemplateTodayMutateAsync, isPending: false })),
}));

const mockUseWorkoutLogsInRange = jest.fn();

jest.mock('../../../services/api/queries/workoutLogs', () => ({
  useWorkoutLogsInRange: (...args: unknown[]) => mockUseWorkoutLogsInRange(...args),
}));

const mockBuildWorkoutSnapshot = jest.fn();

jest.mock('../../../services/api/queries/workoutShares', () => ({
  buildWorkoutSnapshot: (...args: unknown[]) => mockBuildWorkoutSnapshot(...args),
}));

const TEMPLATE = {
  id: 'template-1',
  name: 'Ultimate Core Day',
  workout_template_exercises: [
    {
      id: 'te-1',
      target_sets: 3,
      target_reps_min: 8,
      target_reps_max: 12,
      target_rpe: null,
      rest_seconds: 60,
      exercises: { name: 'Plank' },
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseWorkoutTemplate.mockReturnValue({ data: TEMPLATE, isLoading: false });
  mockUseWorkoutLogsInRange.mockReturnValue({ data: [] });
  mockRouteParams = { weeklyScheduleId: 'ws-1', workoutTemplateId: 'template-1', dayOfWeek: 3 };
});

describe('TrainingDayDetailScreen', () => {
  it('renders the template name, weekday, and exercises', async () => {
    const { getByText } = await render(<TrainingDayDetailScreen />);
    await waitFor(() => expect(getByText('Ultimate Core Day')).toBeTruthy());
    expect(getByText('Wednesday · every week')).toBeTruthy();
    expect(getByText('Plank')).toBeTruthy();
  });

  it('starts a scheduled workout and navigates to it', async () => {
    // Pin "today" to the Wednesday dayOfWeek: 3 resolves to — "Start
    // Workout" renders (but disabled, silently swallowing the press below)
    // whenever this week's Wednesday hasn't arrived yet by the real clock,
    // which made this test's pass/fail depend on which real weekday the
    // suite happened to run on.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-19T12:00:00'));
    mockStartTemplateTodayMutateAsync.mockResolvedValue({ id: 'sw-1' });

    const { getByText } = await render(<TrainingDayDetailScreen />);
    await waitFor(() => expect(getByText('Start Workout')).toBeTruthy());

    await fireEvent.press(getByText('Start Workout'));

    await waitFor(() =>
      expect(mockStartTemplateTodayMutateAsync).toHaveBeenCalledWith({ userId: 'user-1', template: TEMPLATE }),
    );

    jest.useRealTimers();
  });

  it('shows a completed indicator instead of Start Workout once this week\'s date is already logged', async () => {
    const thisWednesday = addDays(startOfWeek(new Date(), { weekStartsOn: 0 }), 3);
    mockUseWorkoutLogsInRange.mockReturnValue({
      data: [{ id: 'log-1', completedAt: `${format(thisWednesday, 'yyyy-MM-dd')}T12:00:00.000Z`, title: 'Ultimate Core Day', rating: null }],
    });

    const { getByText, queryByText } = await render(<TrainingDayDetailScreen />);
    await waitFor(() => expect(getByText('Completed this week')).toBeTruthy());
    expect(queryByText('Start Workout')).toBeNull();
  });

  it('offers Add a Run alongside Start Workout, additive and separate from starting the lift', async () => {
    // Pin "today" to the same Wednesday dayOfWeek: 3 resolves to — real-clock
    // `new Date()` makes this test's future-vs-not-future outcome depend on
    // which real weekday the suite happens to run on otherwise.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-19T12:00:00'));

    const { getByText } = await render(<TrainingDayDetailScreen />);
    await waitFor(() => expect(getByText('Start Workout')).toBeTruthy());

    expect(getByText('Add a Run')).toBeTruthy();
    await fireEvent.press(getByText('Add a Run'));

    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', {
      screen: 'ProgramsTab',
      params: { screen: 'LogCardio', params: { date: '2026-08-19' } },
    });
    expect(mockStartTemplateTodayMutateAsync).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('still offers Add a Run once this week\'s workout is already completed', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-19T12:00:00'));
    mockUseWorkoutLogsInRange.mockReturnValue({
      data: [{ id: 'log-1', completedAt: '2026-08-19T12:00:00.000Z', title: 'Ultimate Core Day', rating: null }],
    });

    const { getByText } = await render(<TrainingDayDetailScreen />);
    await waitFor(() => expect(getByText('Completed this week')).toBeTruthy());
    expect(getByText('Add a Run')).toBeTruthy();

    jest.useRealTimers();
  });

  it('hides Add a Run for a not-yet-arrived day this week, same as Start Workout', async () => {
    // Pin "today" to a known Wednesday so Friday (dayOfWeek 5) is
    // deterministically later in the same Sun-Sat week, regardless of
    // which real weekday the suite happens to run on.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-19T12:00:00'));
    mockRouteParams = { weeklyScheduleId: 'ws-1', workoutTemplateId: 'template-1', dayOfWeek: 5 };

    const { getByText, queryByText } = await render(<TrainingDayDetailScreen />);
    await waitFor(() => expect(getByText('Check back tomorrow!')).toBeTruthy());
    expect(queryByText('Add a Run')).toBeNull();

    jest.useRealTimers();
  });

  it('removes the training day after confirming from the overflow menu', async () => {
    mockRemoveMutateAsync.mockResolvedValue(undefined);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const removeButton = buttons?.find(b => b.text === 'Remove');
      removeButton?.onPress?.();
    });

    const { getByLabelText, getByText } = await render(<TrainingDayDetailScreen />);
    await waitFor(() => expect(getByText('Ultimate Core Day')).toBeTruthy());

    await fireEvent.press(getByLabelText('Training day options'));
    await fireEvent.press(getByText('Remove from Wednesday'));

    await waitFor(() => expect(mockRemoveMutateAsync).toHaveBeenCalledWith({ id: 'ws-1', userId: 'user-1' }));
    expect(mockGoBack).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('builds a snapshot and navigates to ShareWorkout when "Share this workout" is tapped', async () => {
    const snapshot = { name: 'Ultimate Core Day', notes: null, estimatedDurationMinutes: null, exercises: [] };
    mockBuildWorkoutSnapshot.mockResolvedValue(snapshot);

    const { getByLabelText, getByText } = await render(<TrainingDayDetailScreen />);
    await waitFor(() => expect(getByText('Ultimate Core Day')).toBeTruthy());

    await fireEvent.press(getByLabelText('Training day options'));
    await fireEvent.press(getByText('Share this workout'));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('MainTabs', {
        screen: 'ProgramsTab',
        params: {
          screen: 'ShareWorkout',
          params: { shareType: 'single_workout', title: 'Ultimate Core Day', payload: { workout: snapshot } },
        },
      }),
    );
    expect(mockBuildWorkoutSnapshot).toHaveBeenCalledWith(
      { name: 'Ultimate Core Day', notes: undefined, estimatedDurationMinutes: undefined },
      TEMPLATE.workout_template_exercises,
    );
  });
});
