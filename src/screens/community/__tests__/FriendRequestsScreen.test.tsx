import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { FriendRequestsScreen } from '../FriendRequestsScreen';

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

const mockUseIncomingFriendRequests = jest.fn();
const mockUseOutgoingFriendRequests = jest.fn();
const mockAcceptMutate = jest.fn();
const mockDeclineMutate = jest.fn();
const mockRemoveMutate = jest.fn();

jest.mock('../../../services/api/queries/community', () => ({
  useIncomingFriendRequests: (...args: unknown[]) => mockUseIncomingFriendRequests(...args),
  useOutgoingFriendRequests: (...args: unknown[]) => mockUseOutgoingFriendRequests(...args),
  useAcceptFriendRequest: jest.fn(() => ({ mutate: mockAcceptMutate, isPending: false })),
  useDeclineFriendRequest: jest.fn(() => ({ mutate: mockDeclineMutate, isPending: false })),
  useRemoveFriendRequest: jest.fn(() => ({ mutate: mockRemoveMutate, isPending: false })),
}));

const INCOMING = [
  { id: 'user-2', display_name: 'Priya N.', avatar_url: null, handle: 'priyan', requestId: 'req-1', createdAt: '2026-01-01T00:00:00.000Z' },
];
const OUTGOING = [
  { id: 'user-3', display_name: 'Jordan K.', avatar_url: null, handle: 'jordank', requestId: 'req-2', createdAt: '2026-01-01T00:00:00.000Z' },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockUseIncomingFriendRequests.mockReturnValue({ data: INCOMING, isLoading: false, refetch: jest.fn() });
  mockUseOutgoingFriendRequests.mockReturnValue({ data: OUTGOING, isLoading: false, refetch: jest.fn() });
});

describe('FriendRequestsScreen', () => {
  it('shows incoming requests on the Received tab by default, with counts in both tab labels', async () => {
    const { getByText } = await render(<FriendRequestsScreen />);
    await waitFor(() => expect(getByText('Priya N.')).toBeTruthy());

    expect(getByText('Received (1)')).toBeTruthy();
    expect(getByText('Sent (1)')).toBeTruthy();
  });

  it('accepts and declines an incoming request', async () => {
    const { getByText } = await render(<FriendRequestsScreen />);
    await waitFor(() => expect(getByText('Priya N.')).toBeTruthy());

    await fireEvent.press(getByText('Accept'));
    expect(mockAcceptMutate).toHaveBeenCalledWith('req-1', expect.anything());

    await fireEvent.press(getByText('Decline'));
    expect(mockDeclineMutate).toHaveBeenCalledWith('req-1', expect.anything());
  });

  it('switches to the Sent tab and shows outgoing requests as Requested', async () => {
    const { getByText, queryByText } = await render(<FriendRequestsScreen />);
    await waitFor(() => expect(getByText('Received (1)')).toBeTruthy());

    await fireEvent.press(getByText('Sent (1)'));

    await waitFor(() => expect(getByText('Jordan K.')).toBeTruthy());
    expect(getByText('Requested')).toBeTruthy();
    expect(queryByText('Priya N.')).toBeNull();
  });

  it('cancels a sent request from the Sent tab after confirming', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const cancelButton = buttons?.find(b => b.text === 'Cancel Request');
      cancelButton?.onPress?.();
    });

    const { getByText } = await render(<FriendRequestsScreen />);
    await fireEvent.press(getByText('Sent (1)'));
    await waitFor(() => expect(getByText('Requested')).toBeTruthy());

    await fireEvent.press(getByText('Requested'));

    expect(alertSpy).toHaveBeenCalled();
    expect(mockRemoveMutate).toHaveBeenCalledWith('req-2', expect.anything());
  });

  it('shows separate empty states per tab', async () => {
    mockUseIncomingFriendRequests.mockReturnValue({ data: [], isLoading: false, refetch: jest.fn() });
    mockUseOutgoingFriendRequests.mockReturnValue({ data: [], isLoading: false, refetch: jest.fn() });

    const { getByText } = await render(<FriendRequestsScreen />);
    await waitFor(() => expect(getByText('No pending requests')).toBeTruthy());

    await fireEvent.press(getByText('Sent (0)'));
    await waitFor(() => expect(getByText('No sent requests')).toBeTruthy());
  });

  it('navigates to a requester\'s profile on tap', async () => {
    const { getByText } = await render(<FriendRequestsScreen />);
    await waitFor(() => expect(getByText('Priya N.')).toBeTruthy());

    await fireEvent.press(getByText('Priya N.'));
    expect(mockNavigate).toHaveBeenCalledWith('FriendProfile', { userId: 'user-2' });
  });
});
