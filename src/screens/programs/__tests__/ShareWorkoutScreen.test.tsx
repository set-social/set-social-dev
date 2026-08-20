import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ShareWorkoutScreen } from '../ShareWorkoutScreen';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, canGoBack: () => true }),
    useRoute: () => ({
      params: {
        shareType: 'single_workout',
        title: 'Push Day',
        payload: { workout: { name: 'Push Day', notes: null, estimatedDurationMinutes: null, exercises: [] } },
      },
    }),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUseFriendsList = jest.fn();
jest.mock('../../../services/api/queries/community', () => ({
  useFriendsList: (...args: unknown[]) => mockUseFriendsList(...args),
}));

const mockStartConversationMutateAsync = jest.fn();
jest.mock('../../../services/api/queries/directMessages', () => ({
  useStartConversation: jest.fn(() => ({ mutateAsync: mockStartConversationMutateAsync })),
}));

const mockCreateShareMutateAsync = jest.fn();
jest.mock('../../../services/api/queries/workoutShares', () => ({
  useCreateWorkoutShare: jest.fn(() => ({ mutateAsync: mockCreateShareMutateAsync })),
}));

const FRIEND = { id: 'friend-1', display_name: 'Sam K.', avatar_url: null, avatar_focal_x: 0.5, avatar_focal_y: 0.5, handle: 'samk' };

beforeEach(() => {
  jest.clearAllMocks();
  mockUseFriendsList.mockReturnValue({ data: [FRIEND], isLoading: false });
});

describe('ShareWorkoutScreen', () => {
  it('shows the share title and each friend', async () => {
    const { getByText } = await render(<ShareWorkoutScreen />);
    await waitFor(() => expect(getByText('Sam K.')).toBeTruthy());
    expect(getByText('Share "Push Day"')).toBeTruthy();
    expect(getByText('@samk')).toBeTruthy();
  });

  it('starts (or reuses) a conversation, creates the share, then lands on that conversation', async () => {
    mockStartConversationMutateAsync.mockResolvedValue({ id: 'convo-1' });
    mockCreateShareMutateAsync.mockResolvedValue({ id: 'share-1' });

    const { getByText } = await render(<ShareWorkoutScreen />);
    await waitFor(() => expect(getByText('Sam K.')).toBeTruthy());
    await fireEvent.press(getByText('Sam K.'));

    await waitFor(() => expect(mockStartConversationMutateAsync).toHaveBeenCalledWith({ userId: 'user-1', otherUserId: 'friend-1' }));
    expect(mockCreateShareMutateAsync).toHaveBeenCalledWith({
      conversationId: 'convo-1',
      senderId: 'user-1',
      recipientId: 'friend-1',
      shareType: 'single_workout',
      title: 'Push Day',
      payload: { workout: { name: 'Push Day', notes: null, estimatedDurationMinutes: null, exercises: [] } },
    });
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('MainTabs', {
        screen: 'CommunityTab',
        params: { screen: 'Conversation', params: { conversationId: 'convo-1' } },
      }),
    );
  });

  it('shows an empty state with no friends', async () => {
    mockUseFriendsList.mockReturnValue({ data: [], isLoading: false });
    const { getByText } = await render(<ShareWorkoutScreen />);
    await waitFor(() => expect(getByText('No friends yet')).toBeTruthy());
  });

  it('alerts and does not navigate when sharing fails', async () => {
    const { Alert } = jest.requireActual('react-native');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockStartConversationMutateAsync.mockRejectedValue(new Error('network down'));

    const { getByText } = await render(<ShareWorkoutScreen />);
    await waitFor(() => expect(getByText('Sam K.')).toBeTruthy());
    await fireEvent.press(getByText('Sam K.'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Could not share workout', 'network down'));
    expect(mockNavigate).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
