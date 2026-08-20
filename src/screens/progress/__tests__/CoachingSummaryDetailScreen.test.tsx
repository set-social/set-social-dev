import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { CoachingSummaryDetailScreen } from '../CoachingSummaryDetailScreen';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ canGoBack: () => true }),
    useRoute: () => ({ params: { workoutLogId: 'wl-1' } }),
  };
});

jest.mock('../../../hooks/useUnitPreference', () => ({
  useUnitPreference: () => 'kg',
}));

const mockUseCoachingSummary = jest.fn();
jest.mock('../../../services/api/queries/coachingHistory', () => ({
  useCoachingSummary: (...args: unknown[]) => mockUseCoachingSummary(...args),
}));

const PERSISTED_ENTRY = {
  id: 'cs-1',
  workoutLogId: 'wl-1',
  createdAt: '2026-01-15T12:00:00.000Z',
  summary: {
    totalVolumeKg: 1200,
    volumeChangeKg: 200,
    volumeChangePercent: 20,
    newPersonalRecords: [
      { exerciseId: 'ex1', exerciseName: 'Bench Press', loadKg: 100, reps: 5, e1rm: 116.7, loggedAt: '2026-01-15T12:00:00.000Z' },
    ],
    bestSet: { exerciseId: 'ex1', exerciseName: 'Bench Press', loadKg: 100, reps: 5, e1rm: 116.7 },
    improvedExercises: [],
    declinedExercises: [],
    rpeAdherence: { ratedSetCount: 2, averageDelta: 0.5, onTargetSetCount: 2 },
    readinessVsPerformance: null,
    estimatedRecoveryNeeds: 'normal' as const,
    suggestedNextAction: 'Great session — keep the same approach next time.',
    painOrFatigueConcern: null,
    summary: 'You moved 1,200kg of total volume today, up 20% from last time.',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseCoachingSummary.mockReturnValue({ data: PERSISTED_ENTRY, isLoading: false });
});

describe('CoachingSummaryDetailScreen', () => {
  it('renders the persisted summary — same card content WorkoutSummaryScreen shows for a live one', async () => {
    const { getByText } = await render(<CoachingSummaryDetailScreen />);

    await waitFor(() => expect(getByText(PERSISTED_ENTRY.summary.summary)).toBeTruthy());
    expect(getByText('New personal records')).toBeTruthy();
    expect(getByText('Bench Press')).toBeTruthy();
    expect(getByText('Best set')).toBeTruthy();
    expect(getByText(PERSISTED_ENTRY.summary.suggestedNextAction)).toBeTruthy();
  });

  it('fetches by the workoutLogId route param', async () => {
    await render(<CoachingSummaryDetailScreen />);
    expect(mockUseCoachingSummary).toHaveBeenCalledWith('wl-1');
  });

  it('shows a not-found state when no persisted summary exists for this workout', async () => {
    mockUseCoachingSummary.mockReturnValue({ data: null, isLoading: false });
    const { getByText } = await render(<CoachingSummaryDetailScreen />);
    await waitFor(() => expect(getByText('Summary not found')).toBeTruthy());
  });
});
