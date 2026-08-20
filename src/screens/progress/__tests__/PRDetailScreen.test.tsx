import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { PRDetailScreen } from '../PRDetailScreen';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: jest.fn(), canGoBack: () => true }),
    useRoute: () => ({ params: { exerciseId: 'ex1' } }),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUseProfile = jest.fn();
jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: (...args: unknown[]) => mockUseProfile(...args),
}));

jest.mock('../../../hooks/useUnitPreference', () => ({
  useUnitPreference: () => 'kg',
}));

const LOGGED_SETS = [
  { id: 's1', exerciseId: 'ex1', exerciseName: 'Bench Press', reps: 5, loadKg: 100, loggedAt: '2024-02-10T00:00:00.000Z' },
];

jest.mock('../../../services/api/queries/progress', () => {
  const actual = jest.requireActual('../../../services/api/queries/progress');
  return { ...actual, useLoggedSets: jest.fn(() => ({ data: LOGGED_SETS, isLoading: false })) };
});

const mockPredictPersonalRecords = jest.fn();

jest.mock('../../../services/coaching', () => ({
  coachingEngine: {
    predictPersonalRecords: (...args: unknown[]) => mockPredictPersonalRecords(...args),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUseProfile.mockReturnValue({ data: { is_premium: true } });
});

describe('PRDetailScreen', () => {
  it('shows a locked upsell instead of the chart/history for a free user', async () => {
    mockUseProfile.mockReturnValue({ data: { is_premium: false } });
    mockPredictPersonalRecords.mockReturnValue([]);

    const { getByText, queryByText } = await render(<PRDetailScreen />);

    await waitFor(() => expect(getByText('Full PR history')).toBeTruthy());
    expect(getByText('Est. 1RM progression')).toBeTruthy();
    expect(queryByText('PR history')).toBeNull();
  });

  it('renders a Future You card when a prediction exists for this exercise', async () => {
    mockPredictPersonalRecords.mockReturnValue([
      {
        exerciseId: 'ex1',
        exerciseName: 'Bench Press',
        currentBestE1rm: 116.7,
        predictedE1rm: 125,
        targetDate: '2024-05-13',
        confidence: 0.8,
        summary: 'At this pace, your Bench Press could reach ~125kg by May 13.',
      },
    ]);

    const { getByText } = await render(<PRDetailScreen />);

    await waitFor(() => expect(getByText('Future You')).toBeTruthy());
    expect(getByText('At this pace, your Bench Press could reach ~125kg by May 13.')).toBeTruthy();
  });

  it('renders no Future You card when there is no qualifying prediction', async () => {
    mockPredictPersonalRecords.mockReturnValue([]);

    const { queryByText, getByText } = await render(<PRDetailScreen />);

    await waitFor(() => expect(getByText('BEST EST. 1RM')).toBeTruthy());
    expect(queryByText('Future You')).toBeNull();
  });
});
