import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ExercisePickerScreen } from '../ExercisePickerScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: Record<string, unknown> | undefined;

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, canGoBack: () => true }),
    useRoute: () => ({ params: mockRouteParams }),
  };
});

jest.mock('../../../services/api/queries/exercises', () => ({
  useExercises: jest.fn(() => ({
    data: [{ id: 'ex-1', name: 'Bench Press', category: 'push', equipment: 'barbell', primary_muscle: 'chest' }],
    isLoading: false,
  })),
}));

jest.mock('../../../store/activeWorkoutStore', () => ({
  useActiveWorkoutStore: jest.fn(() => jest.fn()),
}));

jest.mock('../../../hooks/useUnitPreference', () => ({
  useUnitPreference: () => 'kg',
}));

const mockAddTemplateExerciseMutate = jest.fn();

jest.mock('../../../services/api/queries/workoutTemplates', () => ({
  useWorkoutTemplate: jest.fn(() => ({ data: { workout_template_exercises: [] } })),
  useAddTemplateExercise: jest.fn(() => ({ mutate: mockAddTemplateExerciseMutate })),
}));

const mockAddProgramExerciseMutate = jest.fn();

jest.mock('../../../services/api/queries/programs', () => ({
  useProgramDay: jest.fn(() => ({ data: { program_exercises: [{ id: 'pe-1' }] } })),
  useAddProgramExercise: jest.fn(() => ({ mutate: mockAddProgramExerciseMutate })),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = undefined;
});

describe('ExercisePickerScreen', () => {
  it('adds a program exercise (not a template exercise) when programDayId is set, then goes back', async () => {
    mockRouteParams = { programDayId: 'day-1' };

    const { getByText } = await render(<ExercisePickerScreen />);
    await waitFor(() => expect(getByText('Bench Press')).toBeTruthy());
    await fireEvent.press(getByText('Bench Press'));

    expect(mockAddProgramExerciseMutate).toHaveBeenCalledWith({
      program_day_id: 'day-1',
      exercise_id: 'ex-1',
      order_index: 1,
      target_sets: 3,
    });
    expect(mockAddTemplateExerciseMutate).not.toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('falls through to viewing exercise detail when neither templateId, programDayId, nor selectMode is set', async () => {
    mockRouteParams = undefined;

    const { getByText } = await render(<ExercisePickerScreen />);
    await waitFor(() => expect(getByText('Bench Press')).toBeTruthy());
    await fireEvent.press(getByText('Bench Press'));

    expect(mockNavigate).toHaveBeenCalledWith('ExerciseDetail', { exerciseId: 'ex-1' });
    expect(mockAddProgramExerciseMutate).not.toHaveBeenCalled();
    expect(mockAddTemplateExerciseMutate).not.toHaveBeenCalled();
  });
});
