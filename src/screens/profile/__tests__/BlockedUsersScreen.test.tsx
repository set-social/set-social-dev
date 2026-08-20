import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { BlockedUsersScreen } from '../BlockedUsersScreen';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ canGoBack: () => true }) };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUseBlockedUsers = jest.fn();
const mockUnblockMutate = jest.fn();

jest.mock('../../../services/api/queries/community', () => ({
  useBlockedUsers: (...args: unknown[]) => mockUseBlockedUsers(...args),
  useUnblockUser: jest.fn(() => ({ mutate: mockUnblockMutate, isPending: false })),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('BlockedUsersScreen', () => {
  it('renders each blocked profile with an Unblock action', async () => {
    mockUseBlockedUsers.mockReturnValue({
      data: [
        { id: 'user-2', display_name: 'Alex B.', avatar_url: null },
        { id: 'user-3', display_name: 'Maya L.', avatar_url: null },
      ],
      isLoading: false,
    });

    const { getByText } = await render(<BlockedUsersScreen />);
    await waitFor(() => expect(getByText('Alex B.')).toBeTruthy());
    expect(getByText('Maya L.')).toBeTruthy();
  });

  it('unblocks the right user when Unblock is pressed', async () => {
    mockUseBlockedUsers.mockReturnValue({
      data: [{ id: 'user-2', display_name: 'Alex B.', avatar_url: null }],
      isLoading: false,
    });

    const { getAllByText } = await render(<BlockedUsersScreen />);
    await waitFor(() => expect(getAllByText('Unblock').length).toBe(1));

    await fireEvent.press(getAllByText('Unblock')[0]);
    expect(mockUnblockMutate).toHaveBeenCalledWith('user-2');
  });

  it('shows an empty state when nobody is blocked', async () => {
    mockUseBlockedUsers.mockReturnValue({ data: [], isLoading: false });

    const { getByText } = await render(<BlockedUsersScreen />);
    await waitFor(() => expect(getByText('No blocked users')).toBeTruthy());
  });
});
