import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { LeaderboardScreen } from '../LeaderboardScreen';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, canGoBack: () => false }),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

jest.mock('../../../hooks/useUnitPreference', () => ({
  useUnitPreference: () => 'kg',
}));

const LEADERBOARD = [
  { id: 'user-1', display_name: 'You', avatar_url: null, volumeThisMonth: 500, workoutsThisMonth: 2, isSelf: true },
  { id: 'user-2', display_name: 'Alex B.', avatar_url: null, volumeThisMonth: 300, workoutsThisMonth: 1, isSelf: false },
];

jest.mock('../../../services/api/queries/community', () => {
  const actual = jest.requireActual('../../../services/api/queries/community');
  return {
    ...actual,
    useLeaderboard: jest.fn(() => ({ data: LEADERBOARD, isLoading: false })),
  };
});

const mockUseLiveFriendWorkouts = jest.fn();

jest.mock('../../../services/api/queries/liveWorkouts', () => ({
  useLiveFriendWorkouts: (...args: unknown[]) => mockUseLiveFriendWorkouts(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.requireMock('../../../services/api/queries/community').useLeaderboard.mockReturnValue({
    data: LEADERBOARD,
    isLoading: false,
  });
  mockUseLiveFriendWorkouts.mockReturnValue({ data: [] });
});

describe('LeaderboardScreen', () => {
  it('renders the ranked leaderboard', async () => {
    const { getByText } = await render(<LeaderboardScreen />);

    await waitFor(() => expect(getByText('You')).toBeTruthy());
    expect(getByText('Alex B.')).toBeTruthy();
  });

  it('navigates to a friend profile when a leaderboard row is pressed', async () => {
    const { getByText } = await render(<LeaderboardScreen />);
    await waitFor(() => expect(getByText('Alex B.')).toBeTruthy());

    await fireEvent.press(getByText('Alex B.'));
    expect(mockNavigate).toHaveBeenCalledWith('FriendProfile', { userId: 'user-2' });
  });

  it('shows an empty state when there are no friends yet', async () => {
    const { useLeaderboard } = jest.requireMock('../../../services/api/queries/community');
    useLeaderboard.mockReturnValue({ data: [LEADERBOARD[0]], isLoading: false });

    const { getByText } = await render(<LeaderboardScreen />);
    await waitFor(() => expect(getByText('No friends yet')).toBeTruthy());
  });

  it('shows a live indicator only next to a friend who is currently mid-workout', async () => {
    mockUseLiveFriendWorkouts.mockReturnValue({
      data: [{ friend: { id: 'user-2' }, workoutLogId: 'log-1' }],
    });

    const { getByText, getAllByLabelText } = await render(<LeaderboardScreen />);
    await waitFor(() => expect(getByText('Alex B.')).toBeTruthy());

    expect(getAllByLabelText('Live now')).toHaveLength(1);
  });

  it('shows no live indicators when no friends are currently working out', async () => {
    const { getByText, queryByLabelText } = await render(<LeaderboardScreen />);
    await waitFor(() => expect(getByText('Alex B.')).toBeTruthy());

    expect(queryByLabelText('Live now')).toBeNull();
  });
});
