import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { CoachingHistoryScreen } from '../CoachingHistoryScreen';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ navigate: mockNavigate, canGoBack: () => true }) };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUseCoachingSummaries = jest.fn();
jest.mock('../../../services/api/queries/coachingHistory', () => ({
  useCoachingSummaries: (...args: unknown[]) => mockUseCoachingSummaries(...args),
}));

const SUMMARY_1 = {
  id: 'cs-1',
  workoutLogId: 'wl-1',
  createdAt: '2026-01-15T12:00:00.000Z',
  summary: {
    totalVolumeKg: 1200,
    volumeChangeKg: 200,
    volumeChangePercent: 20,
    newPersonalRecords: [],
    bestSet: null,
    improvedExercises: [],
    declinedExercises: [],
    rpeAdherence: { ratedSetCount: 0, averageDelta: null, onTargetSetCount: 0 },
    readinessVsPerformance: null,
    estimatedRecoveryNeeds: 'normal' as const,
    suggestedNextAction: 'Keep it up.',
    painOrFatigueConcern: null,
    summary: 'You moved 1,200kg of total volume today, up 20% from last time.',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseCoachingSummaries.mockReturnValue({ data: [SUMMARY_1], isLoading: false });
});

describe('CoachingHistoryScreen', () => {
  it('renders one row per persisted summary, dated and with its headline', async () => {
    const { getByText } = await render(<CoachingHistoryScreen />);
    await waitFor(() => expect(getByText('Jan 15, 2026')).toBeTruthy());
    expect(getByText(SUMMARY_1.summary.summary)).toBeTruthy();
  });

  it('navigates to the detail screen with the right workoutLogId on tap', async () => {
    const { getByText } = await render(<CoachingHistoryScreen />);
    await waitFor(() => expect(getByText('Jan 15, 2026')).toBeTruthy());

    await fireEvent.press(getByText('Jan 15, 2026'));

    expect(mockNavigate).toHaveBeenCalledWith('CoachingSummaryDetail', { workoutLogId: 'wl-1' });
  });

  it('shows an empty state when there are no persisted summaries yet', async () => {
    mockUseCoachingSummaries.mockReturnValue({ data: [], isLoading: false });
    const { getByText } = await render(<CoachingHistoryScreen />);
    await waitFor(() => expect(getByText('No coaching summaries yet')).toBeTruthy());
  });

  // A failed fetch must render distinguishably from "genuinely no rows yet"
  // — this feature has no backfill, so an empty list is also completely
  // normal/expected, which is exactly why a real failure needs its own
  // state rather than looking identical to it.
  it('shows a distinct error state (with retry) when the fetch fails, not the empty state', async () => {
    const mockRefetch = jest.fn();
    mockUseCoachingSummaries.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: mockRefetch });
    const { getByText, queryByText } = await render(<CoachingHistoryScreen />);

    await waitFor(() => expect(getByText("Couldn't load your history")).toBeTruthy());
    expect(queryByText('No coaching summaries yet')).toBeNull();

    await fireEvent.press(getByText('Retry'));
    expect(mockRefetch).toHaveBeenCalled();
  });
});
