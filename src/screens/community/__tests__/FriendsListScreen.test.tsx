import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { FriendsListScreen } from '../FriendsListScreen';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, canGoBack: () => false }),
    useRoute: () => ({ params: { userId: 'user-1', title: 'Friends' } }),
  };
});

const mockUseFriendsList = jest.fn();

jest.mock('../../../services/api/queries/community', () => ({
  useFriendsList: (...args: unknown[]) => mockUseFriendsList(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('FriendsListScreen', () => {
  it('renders each friend with their display name and handle', async () => {
    mockUseFriendsList.mockReturnValue({
      data: [
        { id: 'user-2', display_name: 'Alex B.', avatar_url: null, handle: 'alexb', bio: null, hide_stats_from_friends: false, hide_photos_from_friends: false },
      ],
      isLoading: false,
    });

    const { getByText } = await render(<FriendsListScreen />);
    await waitFor(() => expect(getByText('Alex B.')).toBeTruthy());
    expect(getByText('@alexb')).toBeTruthy();
  });

  it('navigates to that friend\'s profile via the root navigator on tap', async () => {
    mockUseFriendsList.mockReturnValue({
      data: [
        { id: 'user-2', display_name: 'Alex B.', avatar_url: null, handle: null, bio: null, hide_stats_from_friends: false, hide_photos_from_friends: false },
      ],
      isLoading: false,
    });

    const { getByText } = await render(<FriendsListScreen />);
    await waitFor(() => expect(getByText('Alex B.')).toBeTruthy());
    await fireEvent.press(getByText('Alex B.'));

    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', {
      screen: 'CommunityTab',
      params: { screen: 'FriendProfile', params: { userId: 'user-2' } },
    });
  });

  it('shows an empty state with no friends', async () => {
    mockUseFriendsList.mockReturnValue({ data: [], isLoading: false });

    const { getByText } = await render(<FriendsListScreen />);
    await waitFor(() => expect(getByText('No friends yet')).toBeTruthy());
  });
});
