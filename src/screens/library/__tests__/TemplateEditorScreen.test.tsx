import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { TemplateEditorScreen } from '../TemplateEditorScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockSetParams = jest.fn();
let mockRouteParams: {
  templateId?: string;
  scheduleAfterSave?: boolean;
  date?: string;
  replaceScheduledWorkoutId?: string;
} | undefined;

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      setParams: mockSetParams,
      canGoBack: () => true,
    }),
    useRoute: () => ({ params: mockRouteParams }),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const TEMPLATE = {
  id: 'template-1',
  user_id: 'user-1',
  name: 'Push Day',
  notes: null,
  estimated_duration_minutes: null,
  workout_template_exercises: [],
};

const mockCreateScheduledWorkoutMutateAsync = jest.fn();
const mockDeleteScheduledWorkoutMutateAsync = jest.fn();
const mockClearDayOverrideMutateAsync = jest.fn();

jest.mock('../../../services/api/queries/dayOverrides', () => ({
  useClearDayOverride: () => ({ mutateAsync: mockClearDayOverrideMutateAsync, isPending: false }),
}));

jest.mock('../../../services/api/queries/workoutTemplates', () => ({
  useWorkoutTemplate: () => ({ data: TEMPLATE, isLoading: false }),
  useCreateWorkoutTemplate: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdateWorkoutTemplate: () => ({ mutate: jest.fn(), isPending: false }),
  useRemoveTemplateExercise: () => ({ mutate: jest.fn() }),
  useReorderTemplateExercises: () => ({ mutate: jest.fn() }),
}));

jest.mock('../../../services/api/queries/scheduledWorkouts', () => ({
  useCreateScheduledWorkout: () => ({ mutateAsync: mockCreateScheduledWorkoutMutateAsync, isPending: false }),
  useDeleteScheduledWorkout: () => ({ mutateAsync: mockDeleteScheduledWorkoutMutateAsync, isPending: false }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateScheduledWorkoutMutateAsync.mockResolvedValue({ id: 'sw-new' });
  mockDeleteScheduledWorkoutMutateAsync.mockResolvedValue(undefined);
  mockClearDayOverrideMutateAsync.mockResolvedValue(undefined);
});

describe('TemplateEditorScreen — "Schedule This Workout" date/replace flow', () => {
  it('schedules onto the route-param date, not today', async () => {
    mockRouteParams = { templateId: 'template-1', scheduleAfterSave: true, date: '2026-09-14' };
    const { getByText } = await render(<TemplateEditorScreen />);
    await waitFor(() => expect(getByText('Schedule This Workout')).toBeTruthy());

    await fireEvent.press(getByText('Schedule This Workout'));
    await fireEvent.press(getByText('Confirm Date'));

    await waitFor(() =>
      expect(mockCreateScheduledWorkoutMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ scheduledDate: '2026-09-14', sourceTemplateId: 'template-1' }),
      ),
    );
    expect(mockDeleteScheduledWorkoutMutateAsync).not.toHaveBeenCalled();
  });

  it('deletes the replaced scheduled workout before creating the new one', async () => {
    mockRouteParams = {
      templateId: 'template-1',
      scheduleAfterSave: true,
      date: '2026-09-14',
      replaceScheduledWorkoutId: 'sw-old',
    };
    const { getByText } = await render(<TemplateEditorScreen />);
    await waitFor(() => expect(getByText('Schedule This Workout')).toBeTruthy());

    await fireEvent.press(getByText('Schedule This Workout'));
    await fireEvent.press(getByText('Confirm Date'));

    await waitFor(() => expect(mockCreateScheduledWorkoutMutateAsync).toHaveBeenCalled());
    expect(mockDeleteScheduledWorkoutMutateAsync).toHaveBeenCalledWith('sw-old');
  });
});
