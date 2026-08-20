import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { ConversationScreen } from '../ConversationScreen';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, canGoBack: () => true }),
    useRoute: () => ({ params: { conversationId: 'conv-1' } }),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(),
}));

const mockUseConversation = jest.fn();
const mockUseMessages = jest.fn();
const mockSendMessageMutateAsync = jest.fn();
const mockToggleLikeMutate = jest.fn();
const mockDeleteMessageMutate = jest.fn();
const mockDeleteConversationMutate = jest.fn();
const mockUseConversationRealtime = jest.fn();

jest.mock('../../../services/api/queries/directMessages', () => ({
  useConversation: (...args: unknown[]) => mockUseConversation(...args),
  useMessages: (...args: unknown[]) => mockUseMessages(...args),
  useSendMessage: jest.fn(() => ({ mutateAsync: mockSendMessageMutateAsync, isPending: false })),
  useToggleMessageLike: jest.fn(() => ({ mutate: mockToggleLikeMutate, isPending: false })),
  useDeleteMessage: jest.fn(() => ({ mutate: mockDeleteMessageMutate, isPending: false })),
  useDeleteConversation: jest.fn(() => ({ mutate: mockDeleteConversationMutate, isPending: false })),
  useConversationRealtime: (...args: unknown[]) => mockUseConversationRealtime(...args),
  useSignedDmPhotoUrls: jest.fn(() => ({ data: {} })),
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

const MESSAGE_FROM_ME = {
  id: 'msg-1',
  conversation_id: 'conv-1',
  sender_id: 'user-1',
  body: 'Hey!',
  photo_path: null,
  created_at: '2026-01-02T00:00:00.000Z',
  likeCount: 0,
  likedByMe: false,
};

const MESSAGE_FROM_THEM = {
  id: 'msg-2',
  conversation_id: 'conv-1',
  sender_id: 'user-2',
  body: 'Hi there',
  photo_path: null,
  created_at: '2026-01-02T00:01:00.000Z',
  likeCount: 1,
  likedByMe: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseConversation.mockReturnValue({ data: CONVERSATION });
  mockUseMessages.mockReturnValue({ data: [MESSAGE_FROM_ME, MESSAGE_FROM_THEM], isLoading: false });
  (launchImageLibrary as jest.Mock).mockResolvedValue({
    didCancel: false,
    assets: [{ uri: 'file://photo.jpg', type: 'image/jpeg' }],
  });
});

describe('ConversationScreen', () => {
  it('renders messages from both participants and subscribes to realtime', async () => {
    const { getByText } = await render(<ConversationScreen />);

    await waitFor(() => expect(getByText('Hey!')).toBeTruthy());
    expect(getByText('Hi there')).toBeTruthy();
    expect(getByText('Alex B.')).toBeTruthy();
    expect(mockUseConversationRealtime).toHaveBeenCalledWith('conv-1');
  });

  it('sends a text message and clears the composer', async () => {
    mockSendMessageMutateAsync.mockResolvedValue({ ...MESSAGE_FROM_ME, id: 'msg-3', body: 'New message' });

    const { getByText, getByPlaceholderText, getByLabelText } = await render(<ConversationScreen />);
    await waitFor(() => expect(getByText('Hey!')).toBeTruthy());

    const input = getByPlaceholderText('Message');
    await fireEvent.changeText(input, 'New message');
    await fireEvent.press(getByLabelText('Send'));

    expect(mockSendMessageMutateAsync).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      senderId: 'user-1',
      body: 'New message',
      photo: null,
    });
  });

  it('toggles a like on a message', async () => {
    const { getByText, getByLabelText } = await render(<ConversationScreen />);
    await waitFor(() => expect(getByText('Hi there')).toBeTruthy());

    await fireEvent.press(getByLabelText('Unlike message'));
    expect(mockToggleLikeMutate).toHaveBeenCalledWith({
      messageId: 'msg-2',
      conversationId: 'conv-1',
      userId: 'user-1',
      currentlyLiked: true,
    });
  });

  it('offers Unsend only on the viewer\'s own message, and confirms before deleting it', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const unsendButton = buttons?.find(b => b.text === 'Unsend');
      unsendButton?.onPress?.();
    });

    const { getByText, getAllByLabelText } = await render(<ConversationScreen />);
    await waitFor(() => expect(getByText('Hey!')).toBeTruthy());

    // Only msg-1 (sender_id: user-1, "the viewer") gets the affordance —
    // msg-2 is from the other participant.
    const unsendButtons = getAllByLabelText('Unsend message');
    expect(unsendButtons).toHaveLength(1);

    await fireEvent.press(unsendButtons[0]);
    expect(mockDeleteMessageMutate).toHaveBeenCalledWith(
      { messageId: 'msg-1', conversationId: 'conv-1', userId: 'user-1', photoPath: null },
      expect.anything(),
    );
    alertSpy.mockRestore();
  });

  it('deletes the conversation from the header options menu after confirming', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const deleteButton = buttons?.find(b => b.text === 'Delete');
      deleteButton?.onPress?.();
    });

    const { getByText, getByLabelText } = await render(<ConversationScreen />);
    await waitFor(() => expect(getByText('Hey!')).toBeTruthy());

    await fireEvent.press(getByLabelText('Conversation options'));
    await waitFor(() => expect(getByText('Delete Conversation')).toBeTruthy());
    await fireEvent.press(getByText('Delete Conversation'));

    expect(mockDeleteConversationMutate).toHaveBeenCalledWith(
      { conversationId: 'conv-1', userId: 'user-1' },
      expect.anything(),
    );
    alertSpy.mockRestore();
  });

  it('shows a pending-request notice when the viewer is the recipient of a pending thread', async () => {
    mockUseConversation.mockReturnValue({ data: { ...CONVERSATION, status: 'pending', recipient_id: 'user-1', requester_id: 'user-2' } });

    const { getByText } = await render(<ConversationScreen />);
    await waitFor(() => expect(getByText(/isn't in your messages yet/)).toBeTruthy());
  });

  it('renders a shared-workout message as a card and navigates to review it on tap', async () => {
    const shareMessage = {
      id: 'msg-3',
      conversation_id: 'conv-1',
      sender_id: 'user-2',
      body: null,
      photo_path: null,
      created_at: '2026-01-02T00:02:00.000Z',
      likeCount: 0,
      likedByMe: false,
      workout_shares: { id: 'share-1', share_type: 'single_workout' as const, title: 'Push Day', status: 'pending' as const },
    };
    mockUseMessages.mockReturnValue({ data: [MESSAGE_FROM_ME, shareMessage], isLoading: false });

    const { getByText } = await render(<ConversationScreen />);
    await waitFor(() => expect(getByText('Push Day')).toBeTruthy());
    expect(getByText(/Tap to review/)).toBeTruthy();

    await fireEvent.press(getByText('Push Day'));
    expect(mockNavigate).toHaveBeenCalledWith('SharedWorkoutReview', { shareId: 'share-1' });
  });
});
