import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ProgressTimelineScreen } from '../ProgressTimelineScreen';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ navigate: mockNavigate, canGoBack: () => false }) };
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
  return {
    ...actual,
    useLoggedSets: jest.fn(() => ({ data: LOGGED_SETS, isLoading: false })),
    computePrEvents: jest.fn(() => [
      { exerciseId: 'ex1', exerciseName: 'Bench Press', loadKg: 100, reps: 5, e1rm: 116.7, loggedAt: '2024-02-10T00:00:00.000Z' },
    ]),
  };
});

jest.mock('../../../services/api/queries/bodyMetrics', () => ({
  useBodyMetrics: jest.fn(() => ({ data: [{ logged_at: '2024-02-05', weight_kg: 82 }], isLoading: false })),
}));

const mockDeleteWorkoutLogMutate = jest.fn();

jest.mock('../../../services/api/queries/workoutLogs', () => ({
  useAllWorkoutLogs: jest.fn(() => ({
    data: [{ id: 'log-1', completedAt: '2024-02-01T00:00:00.000Z', title: 'Push Day', rating: 4 }],
    isLoading: false,
  })),
  useDeleteWorkoutLog: jest.fn(() => ({ mutate: mockDeleteWorkoutLogMutate })),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUseProfile.mockReturnValue({ data: { is_premium: true } });
});

describe('ProgressTimelineScreen', () => {
  it('shows a locked upsell instead of the timeline for a free user', async () => {
    mockUseProfile.mockReturnValue({ data: { is_premium: false } });

    const { getByText, queryByText } = await render(<ProgressTimelineScreen />);

    await waitFor(() => expect(getByText('Unlock with Pro')).toBeTruthy());
    expect(queryByText('FEBRUARY 2024')).toBeNull();

    await fireEvent.press(getByText('Unlock with Pro'));
    expect(mockNavigate).toHaveBeenCalledWith('Paywall', { trigger: 'analytics' });
  });

  it('renders merged entries grouped under a month header', async () => {
    const { getByText } = await render(<ProgressTimelineScreen />);

    await waitFor(() => expect(getByText('FEBRUARY 2024')).toBeTruthy());
    expect(getByText('Bench Press')).toBeTruthy();
    expect(getByText('Body weight logged')).toBeTruthy();
    expect(getByText('Push Day')).toBeTruthy();
  });

  it('navigates to PRDetail with the exercise id when a PR row is pressed', async () => {
    const { getByText } = await render(<ProgressTimelineScreen />);
    await waitFor(() => expect(getByText('Bench Press')).toBeTruthy());

    await fireEvent.press(getByText('Bench Press'));

    expect(mockNavigate).toHaveBeenCalledWith('PRDetail', { exerciseId: 'ex1' });
  });

  it('deletes a completed workout after confirming', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const deleteButton = buttons?.find(b => b.text === 'Delete');
      deleteButton?.onPress?.();
    });

    const { getByLabelText } = await render(<ProgressTimelineScreen />);
    await waitFor(() => expect(getByLabelText('Delete workout')).toBeTruthy());
    await fireEvent.press(getByLabelText('Delete workout'));

    expect(mockDeleteWorkoutLogMutate).toHaveBeenCalledWith('log-1');
    alertSpy.mockRestore();
  });
});
