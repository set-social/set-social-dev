import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ChooseVariantScreen } from '../ChooseVariantScreen';

const mockNavigate = jest.fn();
const mockReplace = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, replace: mockReplace, canGoBack: () => false }),
    useRoute: () => ({ params: { programDayId: 'day-1' } }),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const PROGRAM_DAY = {
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

jest.mock('../../../services/api/queries/programs', () => ({
  useProgramDay: jest.fn(() => ({ data: PROGRAM_DAY, isLoading: false })),
}));

jest.mock('../../../services/api/queries/scheduledWorkouts', () => ({
  useScheduledWorkout: jest.fn(() => ({ data: undefined, isLoading: false })),
}));

jest.mock('../../../services/api/queries/exercises', () => ({
  useExercises: jest.fn(() => ({ data: EXERCISE_LIBRARY, isLoading: false })),
}));

jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: jest.fn(() => ({ data: { id: 'user-1', equipment_access: ['barbell'] }, isLoading: false })),
}));

const LABELS: Record<string, string> = {
  full: 'Full Workout',
  time_45: '45-Minute Version',
  time_30: '30-Minute Version',
  hotel: 'Hotel Gym Version',
  home: 'Home Gym Version',
  bodyweight: 'Bodyweight Version',
  low_readiness: 'Low-Readiness Version',
  strength_focus: 'Strength-Focused Version',
  hypertrophy_focus: 'Hypertrophy-Focused Version',
  reduced_impact: 'Reduced-Impact Version',
};

const VARIANT_ORDER = [
  'full',
  'time_45',
  'time_30',
  'hotel',
  'home',
  'bodyweight',
  'low_readiness',
  'strength_focus',
  'hypertrophy_focus',
  'reduced_impact',
];

jest.mock('../../../services/coaching', () => ({
  coachingEngine: {
    generateWorkoutVariant: jest.fn(),
  },
}));

import { coachingEngine } from '../../../services/coaching';

const mockedGenerateWorkoutVariant = coachingEngine.generateWorkoutVariant as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockedGenerateWorkoutVariant.mockImplementation(({ variantType }: { variantType: string }) => ({
    variantType,
    label: LABELS[variantType],
    summary: `${variantType} summary`,
    estimatedMinutes: 30,
    exercises: [
      { exerciseId: 'ex1', exerciseName: 'Bench Press', targetSets: 3, targetRepsMin: 8, targetRepsMax: 10, targetLoadKg: 60, targetRpe: 8, restSeconds: 90 },
    ],
    changes: [{ exerciseId: 'ex1', type: 'kept', reason: 'No changes.' }],
  }));
});

describe('ChooseVariantScreen', () => {
  it('renders all 10 variant options with computed estimates', async () => {
    const { getByText, getAllByText } = await render(<ChooseVariantScreen />);

    for (const label of Object.values(LABELS)) {
      expect(getByText(label)).toBeTruthy();
    }
    expect(getAllByText('Choose this')).toHaveLength(10);
    expect(mockedGenerateWorkoutVariant).toHaveBeenCalledTimes(10);
  });

  it('navigates directly to ActiveWorkoutOverview with the chosen variantType, skipping PreWorkoutReview', async () => {
    const { getAllByText } = await render(<ChooseVariantScreen />);

    const chooseButtons = getAllByText('Choose this');
    await fireEvent.press(chooseButtons[VARIANT_ORDER.indexOf('time_30')]);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('ActiveWorkoutOverview', { programDayId: 'day-1', variantType: 'time_30' }));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('routes the full-workout choice through the normal start-workout flow', async () => {
    const { getAllByText } = await render(<ChooseVariantScreen />);

    const chooseButtons = getAllByText('Choose this');
    await fireEvent.press(chooseButtons[VARIANT_ORDER.indexOf('full')]);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('MainTabs', expect.objectContaining({ screen: 'ProgramsTab' })),
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
