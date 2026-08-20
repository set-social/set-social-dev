import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { LibraryScreen } from '../LibraryScreen';

const mockNavigate = jest.fn();
let mockRouteParams: { pickMode?: boolean; date?: string; replaceScheduledWorkoutId?: string } | undefined;

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), canGoBack: () => true }),
    useRoute: () => ({ params: mockRouteParams }),
  };
});

const mockFetchQuery = jest.fn((opts: { queryFn: () => unknown }) => Promise.resolve(opts.queryFn()));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ fetchQuery: mockFetchQuery, invalidateQueries: jest.fn() }),
}));

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const TEMPLATE_TREE = {
  id: 'template-1',
  name: 'Push Day',
  workout_template_exercises: [{ id: 'te-1', order_index: 0, exercises: { name: 'Bench Press' } }],
};

const mockCreateScheduledWorkoutMutateAsync = jest.fn();
const mockDeleteScheduledWorkoutMutateAsync = jest.fn();
const mockClearDayOverrideMutateAsync = jest.fn();

jest.mock('../../../services/api/queries/dayOverrides', () => ({
  useClearDayOverride: () => ({ mutateAsync: mockClearDayOverrideMutateAsync, isPending: false }),
}));

jest.mock('../../../services/api/queries/workoutTemplates', () => ({
  useWorkoutTemplates: () => ({
    data: [{ id: 'template-1', name: 'Push Day', workout_template_exercises: [{ order_index: 0, exercises: { name: 'Bench Press' } }] }],
    isLoading: false,
    refetch: jest.fn(),
  }),
  useDeleteWorkoutTemplate: () => ({ mutate: jest.fn(), isPending: false }),
  useDuplicateWorkoutTemplate: () => ({ mutate: jest.fn(), isPending: false }),
  useCreateTemplateFromProgramDay: () => ({ mutateAsync: jest.fn(), isPending: false }),
  fetchWorkoutTemplate: jest.fn(() => Promise.resolve(TEMPLATE_TREE)),
}));

jest.mock('../../../services/api/queries/programs', () => ({
  useAllProgramDaysWithExercises: () => ({ data: [], isLoading: false, refetch: jest.fn() }),
  fetchProgramDay: jest.fn(),
}));

jest.mock('../../../services/api/queries/scheduledWorkouts', () => ({
  useCreateScheduledWorkout: () => ({ mutateAsync: mockCreateScheduledWorkoutMutateAsync, isPending: false }),
  useDeleteScheduledWorkout: () => ({ mutateAsync: mockDeleteScheduledWorkoutMutateAsync, isPending: false }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = { pickMode: true };
  mockCreateScheduledWorkoutMutateAsync.mockResolvedValue({ id: 'sw-new' });
  mockDeleteScheduledWorkoutMutateAsync.mockResolvedValue(undefined);
  mockClearDayOverrideMutateAsync.mockResolvedValue(undefined);
});

describe('LibraryScreen — schedule/change-workout flow', () => {
  it('schedules onto today when opened with no date param', async () => {
    const { getByText } = await render(<LibraryScreen />);
    await waitFor(() => expect(getByText('Push Day')).toBeTruthy());

    await fireEvent.press(getByText('Add to Calendar'));
    await fireEvent.press(getByText('Confirm Date'));

    await waitFor(() => expect(mockCreateScheduledWorkoutMutateAsync).toHaveBeenCalled());
    const call = mockCreateScheduledWorkoutMutateAsync.mock.calls[0][0];
    const today = new Date();
    const expectedDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(call.scheduledDate).toBe(expectedDate);
    expect(mockDeleteScheduledWorkoutMutateAsync).not.toHaveBeenCalled();
  });

  it('schedules onto the route-param date (CalendarScreen "Change Workout"), not today', async () => {
    mockRouteParams = { pickMode: true, date: '2026-09-14' };
    const { getByText } = await render(<LibraryScreen />);
    await waitFor(() => expect(getByText('Push Day')).toBeTruthy());

    await fireEvent.press(getByText('Add to Calendar'));
    await fireEvent.press(getByText('Confirm Date'));

    await waitFor(() =>
      expect(mockCreateScheduledWorkoutMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ scheduledDate: '2026-09-14', sourceTemplateId: 'template-1' }),
      ),
    );
  });

  it('deletes the replaced scheduled workout before creating the new one', async () => {
    mockRouteParams = { pickMode: true, date: '2026-09-14', replaceScheduledWorkoutId: 'sw-old' };
    const { getByText } = await render(<LibraryScreen />);
    await waitFor(() => expect(getByText('Push Day')).toBeTruthy());

    await fireEvent.press(getByText('Add to Calendar'));
    await fireEvent.press(getByText('Confirm Date'));

    await waitFor(() => expect(mockCreateScheduledWorkoutMutateAsync).toHaveBeenCalled());
    expect(mockDeleteScheduledWorkoutMutateAsync).toHaveBeenCalledWith('sw-old');
  });
});
