import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { ExerciseDetailScreen } from '../ExerciseDetailScreen';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ push: jest.fn(), canGoBack: () => true }),
    useRoute: () => ({ params: { exerciseId: 'ex1' } }),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const EXERCISE = {
  id: 'ex1',
  name: 'Squat',
  category: 'legs',
  primary_muscle: 'quadriceps',
  secondary_muscles: [],
  equipment: 'barbell',
  instructions: 'Squat down and stand back up.',
  demo_media_url: null,
  demo_media_type: null,
  is_custom: false,
  created_by: null,
  created_at: '2024-01-01T00:00:00.000Z',
  movement_pattern: 'squat',
  difficulty: 'intermediate',
  joint_stress: 'moderate',
  skill_requirement: 'moderate',
  default_metric: null,
};

jest.mock('../../../services/api/queries/exercises', () => ({
  useExercise: jest.fn(() => ({ data: EXERCISE, isLoading: false })),
  useExercises: jest.fn(() => ({ data: [EXERCISE], isLoading: false })),
  useUpdateExercise: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
}));

jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: jest.fn(() => ({ data: null, isLoading: false })),
}));

jest.mock('../../../services/coaching', () => ({
  coachingEngine: {
    recommendExerciseSubstitution: jest.fn(() => []),
    generateExerciseExplanation: jest.fn(() => ({
      purpose: 'This exercise builds lower-body strength. It primarily targets your quadriceps.',
      progressionCriteria: 'Once every set feels easy, add weight next session.',
      regressionCriteria: 'If reps are hard to hit, drop the weight.',
    })),
  },
}));

describe('ExerciseDetailScreen', () => {
  it('renders the Why this exercise card with the engine-provided text', async () => {
    const { getByText } = await render(<ExerciseDetailScreen />);

    await waitFor(() => expect(getByText('Why this exercise')).toBeTruthy());
    expect(getByText('This exercise builds lower-body strength. It primarily targets your quadriceps.')).toBeTruthy();
    expect(getByText('Once every set feels easy, add weight next session.')).toBeTruthy();
    expect(getByText('If reps are hard to hit, drop the weight.')).toBeTruthy();
  });
});
