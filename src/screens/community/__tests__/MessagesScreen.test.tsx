import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { MessagesScreen } from '../MessagesScreen';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ navigate: mockNavigate, canGoBack: () => false }) };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUseConversations = jest.fn();
const mockUseIncomingDmRequests = jest.fn();
const mockUseOutgoingDmRequests = jest.fn();
const mockRespondMutate = jest.fn();
const mockDeleteConversationMutate = jest.fn();

jest.mock('../../../services/api/queries/directMessages', () => ({
  useConversations: (...args: unknown[]) => mockUseConversations(...args),
  useIncomingDmRequests: (...args: unknown[]) => mockUseIncomingDmRequests(...args),
  useOutgoingDmRequests: (...args: unknown[]) => mockUseOutgoingDmRequests(...args),
  useRespondToConversation: jest.fn(() => ({ mutate: mockRespondMutate, isPending: false })),
  useDeleteConversation: jest.fn(() => ({ mutate: mockDeleteConversationMutate, isPending: false })),
}));

jest.mock('../../../services/api/queries/community', () => ({
  useBlockUser: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
}));

jest.mock('../../../services/api/queries/reports', () => ({
  useCreateReport: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
}));

const CONVERSATION = {
  id: 'conv-1',
  requester_id: 'user-1',
  recipient_id: 'user-2',
  status: 'accepted' as const,
  created_at: '2026-01-01T00:00:00.000Z',
  last_message_at: '2026-01-02T00:00:00.000Z',
  otherParticipant: { id: 'user-2', display_name: 'Alex B.', avatar_url: null, handle: null, bio: null, hide_stats_from_friends: false, hide_photos_from_friends: false },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseConversations.mockReturnValue({ data: [], isLoading: false, refetch: jest.fn() });
  mockUseIncomingDmRequests.mockReturnValue({ data: [], isLoading: false, refetch: jest.fn() });
  mockUseOutgoingDmRequests.mockReturnValue({ data: [], isLoading: false, refetch: jest.fn() });
});

describe('MessagesScreen', () => {
  it('shows an empty state when there are no conversations', async () => {
    const { getByText } = await render(<MessagesScreen />);
    await waitFor(() => expect(getByText('No messages yet')).toBeTruthy());
  });

  it('lists conversations and navigates into one on tap', async () => {
    mockUseConversations.mockReturnValue({ data: [CONVERSATION], isLoading: false, refetch: jest.fn() });

    const { getByText } = await render(<MessagesScreen />);
    await waitFor(() => expect(getByText('Alex B.')).toBeTruthy());

    await fireEvent.press(getByText('Alex B.'));
    expect(mockNavigate).toHaveBeenCalledWith('Conversation', { conversationId: 'conv-1' });
  });

  it('accepts an incoming request from the Requests tab', async () => {
    mockUseIncomingDmRequests.mockReturnValue({
      data: [{ ...CONVERSATION, id: 'conv-2', status: 'pending' }],
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<MessagesScreen />);
    await fireEvent.press(getByText(/^Requests/));
    await waitFor(() => expect(getByText('Accept')).toBeTruthy());

    await fireEvent.press(getByText('Accept'));
    expect(mockRespondMutate).toHaveBeenCalledWith({ id: 'conv-2', userId: 'user-1', status: 'accepted' });
  });

  it('shows outgoing requests as Pending', async () => {
    mockUseOutgoingDmRequests.mockReturnValue({
      data: [{ ...CONVERSATION, id: 'conv-3', status: 'pending' }],
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<MessagesScreen />);
    await fireEvent.press(getByText(/^Requests/));
    await waitFor(() => expect(getByText('Pending')).toBeTruthy());
  });

  it('deletes a conversation from the options menu after confirming', async () => {
    mockUseConversations.mockReturnValue({ data: [CONVERSATION], isLoading: false, refetch: jest.fn() });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const deleteButton = buttons?.find(b => b.text === 'Delete');
      deleteButton?.onPress?.();
    });

    const { getByLabelText, getByText } = await render(<MessagesScreen />);
    await waitFor(() => expect(getByText('Alex B.')).toBeTruthy());

    await fireEvent.press(getByLabelText('Conversation options'));
    await waitFor(() => expect(getByText('Delete Conversation')).toBeTruthy());
    await fireEvent.press(getByText('Delete Conversation'));

    expect(mockDeleteConversationMutate).toHaveBeenCalledWith(
      { conversationId: 'conv-1', userId: 'user-1' },
      expect.anything(),
    );
    alertSpy.mockRestore();
  });

  it('opens Report/Block from the options menu instead of deleting', async () => {
    mockUseConversations.mockReturnValue({ data: [CONVERSATION], isLoading: false, refetch: jest.fn() });

    const { getByLabelText, getByText } = await render(<MessagesScreen />);
    await waitFor(() => expect(getByText('Alex B.')).toBeTruthy());

    await fireEvent.press(getByLabelText('Conversation options'));
    await fireEvent.press(getByText('Report or Block'));

    await waitFor(() => expect(getByText('Report')).toBeTruthy());
    expect(mockDeleteConversationMutate).not.toHaveBeenCalled();
  });
});
