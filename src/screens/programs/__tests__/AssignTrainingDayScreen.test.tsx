import React from 'react';
import { Alert } from 'react-native';
import { addDays, format, startOfWeek } from 'date-fns';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { AssignTrainingDayScreen } from '../AssignTrainingDayScreen';

const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ goBack: mockGoBack, canGoBack: () => true }),
    useRoute: () => ({ params: undefined }),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUseWorkoutTemplates = jest.fn();

jest.mock('../../../services/api/queries/workoutTemplates', () => ({
  useWorkoutTemplates: (...args: unknown[]) => mockUseWorkoutTemplates(...args),
}));

const mockAssignMutateAsync = jest.fn();

jest.mock('../../../services/api/queries/weeklySchedule', () => ({
  useAssignWeeklySchedule: jest.fn(() => ({ mutateAsync: mockAssignMutateAsync, isPending: false })),
}));

const mockClearDayOverrideMutateAsync = jest.fn();

jest.mock('../../../services/api/queries/dayOverrides', () => ({
  useClearDayOverride: jest.fn(() => ({ mutateAsync: mockClearDayOverrideMutateAsync })),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUseWorkoutTemplates.mockReturnValue({
    data: [{ id: 'template-1', name: 'Ultimate Core Day', workout_template_exercises: [{ order_index: 0 }, { order_index: 1 }] }],
    isLoading: false,
  });
  mockAssignMutateAsync.mockResolvedValue(undefined);
  mockClearDayOverrideMutateAsync.mockResolvedValue(undefined);
});

describe('AssignTrainingDayScreen', () => {
  it('prompts to pick a day first when tapping a workout before a day is selected', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByText } = await render(<AssignTrainingDayScreen />);
    await waitFor(() => expect(getByText('Ultimate Core Day')).toBeTruthy());

    await fireEvent.press(getByText('Ultimate Core Day'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Pick a day first',
      'Choose which day of the week this workout belongs to.',
    );
    expect(mockAssignMutateAsync).not.toHaveBeenCalled();
  });

  it('assigns immediately on tapping a workout once a day is picked, with no separate confirm step', async () => {
    const { getByText, queryByText } = await render(<AssignTrainingDayScreen />);
    await waitFor(() => expect(getByText('Ultimate Core Day')).toBeTruthy());

    expect(queryByText('Assign')).toBeNull();

    await fireEvent.press(getByText('W'));
    await fireEvent.press(getByText('Ultimate Core Day'));

    await waitFor(() =>
      expect(mockAssignMutateAsync).toHaveBeenCalledWith({ userId: 'user-1', dayOfWeek: 3, workoutTemplateId: 'template-1' }),
    );
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('clears this week\'s override for the assigned day, so a day previously marked Rest/Missed shows the new assignment right away instead of only from next week', async () => {
    const { getByText } = await render(<AssignTrainingDayScreen />);
    await waitFor(() => expect(getByText('Ultimate Core Day')).toBeTruthy());

    await fireEvent.press(getByText('W'));
    await fireEvent.press(getByText('Ultimate Core Day'));

    const expectedDate = format(addDays(startOfWeek(new Date(), { weekStartsOn: 0 }), 3), 'yyyy-MM-dd');
    await waitFor(() =>
      expect(mockClearDayOverrideMutateAsync).toHaveBeenCalledWith({ userId: 'user-1', date: expectedDate }),
    );
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('still assigns and navigates back even if clearing the override fails (best-effort, not a blocking step)', async () => {
    mockClearDayOverrideMutateAsync.mockRejectedValue(new Error('network error'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByText } = await render(<AssignTrainingDayScreen />);
    await waitFor(() => expect(getByText('Ultimate Core Day')).toBeTruthy());

    await fireEvent.press(getByText('W'));
    await fireEvent.press(getByText('Ultimate Core Day'));

    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('shows an empty state when there are no saved workout templates', async () => {
    mockUseWorkoutTemplates.mockReturnValue({ data: [], isLoading: false });

    const { getByText } = await render(<AssignTrainingDayScreen />);
    await waitFor(() => expect(getByText('No saved workouts yet')).toBeTruthy());
  });
});
