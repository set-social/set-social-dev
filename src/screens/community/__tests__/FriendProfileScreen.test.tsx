import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { FriendProfileScreen } from '../FriendProfileScreen';

const mockNavigate = jest.fn();
let mockRouteUserId = 'user-2';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, canGoBack: () => false }),
    useRoute: () => ({ params: { userId: mockRouteUserId } }),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUploadAvatarMutateAsync = jest.fn();
const mockUpdateProfileMutateAsync = jest.fn();

jest.mock('../../../services/api/queries/profiles', () => ({
  useUploadAvatar: jest.fn(() => ({ mutateAsync: mockUploadAvatarMutateAsync })),
  useUpdateProfile: jest.fn(() => ({ mutateAsync: mockUpdateProfileMutateAsync, isPending: false })),
}));

jest.mock('../../../hooks/useUnitPreference', () => ({
  useUnitPreference: () => 'kg',
}));

const mockLaunchImageLibrary = jest.fn();

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: (...args: unknown[]) => mockLaunchImageLibrary(...args),
}));

const mockStartConversationMutateAsync = jest.fn();

jest.mock('../../../services/api/queries/directMessages', () => ({
  useStartConversation: jest.fn(() => ({ mutateAsync: mockStartConversationMutateAsync, isPending: false })),
}));

const mockUseUserPosts = jest.fn();

jest.mock('../../../services/api/queries/posts', () => {
  const actual = jest.requireActual('../../../services/api/queries/posts');
  return {
    ...actual,
    useUserPosts: (...args: unknown[]) => mockUseUserPosts(...args),
    useSignedPhotoUrls: jest.fn(() => ({ data: {} })),
  };
});

const PROFILE = { id: 'user-2', display_name: 'Alex B.', avatar_url: null, volumeThisMonth: 1000, workoutsThisMonth: 4 };

const mockUseFriendProfile = jest.fn();
const mockUseFriendRelationships = jest.fn();
const mockUseIsBlocked = jest.fn();
const mockSendMutate = jest.fn();
const mockAcceptMutate = jest.fn();
const mockDeclineMutate = jest.fn();
const mockRemoveMutate = jest.fn();
const mockBlockMutate = jest.fn();

jest.mock('../../../services/api/queries/community', () => {
  const actual = jest.requireActual('../../../services/api/queries/community');
  return {
    ...actual,
    useFriendProfile: (...args: unknown[]) => mockUseFriendProfile(...args),
    useFriendCount: jest.fn(() => ({ data: 2 })),
    useFriendRelationships: (...args: unknown[]) => mockUseFriendRelationships(...args),
    useIsBlocked: (...args: unknown[]) => mockUseIsBlocked(...args),
    useSendFriendRequest: jest.fn(() => ({ mutate: mockSendMutate, isPending: false })),
    useAcceptFriendRequest: jest.fn(() => ({ mutate: mockAcceptMutate, isPending: false })),
    useDeclineFriendRequest: jest.fn(() => ({ mutate: mockDeclineMutate, isPending: false })),
    useRemoveFriendRequest: jest.fn(() => ({ mutate: mockRemoveMutate, isPending: false })),
    useBlockUser: jest.fn(() => ({ mutate: mockBlockMutate, isPending: false })),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteUserId = 'user-2';
  mockUseFriendProfile.mockReturnValue({ data: PROFILE, isLoading: false });
  mockUseIsBlocked.mockReturnValue({ data: false, isLoading: false });
  mockUseUserPosts.mockReturnValue({ data: [], isLoading: false });
  mockUseFriendRelationships.mockReturnValue({
    data: { friendIds: new Set(), outgoingByAddressee: new Map(), incomingByRequester: new Map() },
  });
});

describe('FriendProfileScreen', () => {
  it('shows "Add Friend" and sends a request when there is no relationship yet', async () => {
    mockUseFriendRelationships.mockReturnValue({
      data: { friendIds: new Set(), outgoingByAddressee: new Map(), incomingByRequester: new Map() },
    });

    const { getByText } = await render(<FriendProfileScreen />);
    await waitFor(() => expect(getByText('Alex B.')).toBeTruthy());

    await fireEvent.press(getByText('Add Friend'));
    expect(mockSendMutate).toHaveBeenCalledWith('user-2', expect.anything());
  });

  it('starts a conversation and navigates to it when Message is pressed', async () => {
    mockStartConversationMutateAsync.mockResolvedValue({ id: 'conv-1' });

    const { getByText } = await render(<FriendProfileScreen />);
    await waitFor(() => expect(getByText('Message')).toBeTruthy());

    await fireEvent.press(getByText('Message'));

    expect(mockStartConversationMutateAsync).toHaveBeenCalledWith({ userId: 'user-1', otherUserId: 'user-2' });
    expect(mockNavigate).toHaveBeenCalledWith('Conversation', { conversationId: 'conv-1' });
  });

  it('shows an Accept/Decline pair for an incoming request', async () => {
    mockUseFriendRelationships.mockReturnValue({
      data: {
        friendIds: new Set(),
        outgoingByAddressee: new Map(),
        incomingByRequester: new Map([['user-2', 'req-1']]),
      },
    });

    const { getByText } = await render(<FriendProfileScreen />);
    await waitFor(() => expect(getByText('Accept')).toBeTruthy());

    await fireEvent.press(getByText('Accept'));
    expect(mockAcceptMutate).toHaveBeenCalledWith('req-1', expect.anything());

    await fireEvent.press(getByText('Decline'));
    expect(mockDeclineMutate).toHaveBeenCalledWith('req-1', expect.anything());
  });

  it('shows "Friends" once accepted', async () => {
    mockUseFriendRelationships.mockReturnValue({
      data: { friendIds: new Set(['user-2']), outgoingByAddressee: new Map(), incomingByRequester: new Map() },
    });

    // Two legitimate "Friends" texts once accepted: the FriendRequestButton's
    // state label, and the merged Volume/Workouts/Friends stat strip's label
    // (which replaced the old separate Followers/Following rows).
    const { getAllByText } = await render(<FriendProfileScreen />);
    await waitFor(() => expect(getAllByText('Friends').length).toBe(2));
  });

  it('blocks the profile via the overflow menu after confirming', async () => {
    mockUseFriendRelationships.mockReturnValue({
      data: { friendIds: new Set(), outgoingByAddressee: new Map(), incomingByRequester: new Map() },
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const blockButton = buttons?.find(b => b.text === 'Block');
      blockButton?.onPress?.();
    });

    const { getByLabelText, getByText } = await render(<FriendProfileScreen />);
    await waitFor(() => expect(getByText('Alex B.')).toBeTruthy());

    await fireEvent.press(getByLabelText('Profile options'));
    await fireEvent.press(getByText('Block Alex B.'));

    expect(alertSpy).toHaveBeenCalled();
    expect(mockBlockMutate).toHaveBeenCalledWith('user-2');
    alertSpy.mockRestore();
  });

  it('shows a plain unavailable state instead of the profile when the target is blocked', async () => {
    mockUseFriendRelationships.mockReturnValue({
      data: { friendIds: new Set(), outgoingByAddressee: new Map(), incomingByRequester: new Map() },
    });
    mockUseIsBlocked.mockReturnValue({ data: true, isLoading: false });

    const { getByText, queryByText } = await render(<FriendProfileScreen />);
    await waitFor(() => expect(getByText('This profile is unavailable.')).toBeTruthy());
    expect(queryByText('Alex B.')).toBeNull();
  });

  it('shows a Posts section from useUserPosts with no visibility badges', async () => {
    mockUseFriendRelationships.mockReturnValue({
      data: { friendIds: new Set(['user-2']), outgoingByAddressee: new Map(), incomingByRequester: new Map() },
    });
    mockUseUserPosts.mockReturnValue({
      data: [
        {
          id: 'post-1',
          user_id: 'user-2',
          post_type: 'progress_photo',
          visibility: 'friends',
          caption: null,
          photo_path: 'user-2/friends/a.jpg',
          before_photo_path: null,
          after_photo_path: null,
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      isLoading: false,
    });

    const { getByText, queryByText } = await render(<FriendProfileScreen />);
    await waitFor(() => expect(getByText('POSTS')).toBeTruthy());
    expect(queryByText('🔒 Private')).toBeNull();
    expect(queryByText('👥 Friends')).toBeNull();
  });

  describe('viewing your own profile', () => {
    beforeEach(() => {
      mockRouteUserId = 'user-1';
    });

    it('does not show the FriendRequestButton or overflow menu', async () => {
      const { getByText, queryByText, queryByLabelText } = await render(<FriendProfileScreen />);
      await waitFor(() => expect(getByText('Alex B.')).toBeTruthy());
      expect(queryByText('Add Friend')).toBeNull();
      expect(queryByLabelText('Profile options')).toBeNull();
    });

    it('opens the bio editor and saves a new bio', async () => {
      const { getByText, getByPlaceholderText } = await render(<FriendProfileScreen />);
      await waitFor(() => expect(getByText('Add a bio')).toBeTruthy());

      await fireEvent.press(getByText('Add a bio'));
      const input = getByPlaceholderText('Tell friends about yourself');
      await fireEvent.changeText(input, 'Powerlifter, coffee enthusiast');
      await fireEvent.press(getByText('Save'));

      expect(mockUpdateProfileMutateAsync).toHaveBeenCalledWith({ bio: 'Powerlifter, coffee enthusiast' });
    });

    it('shows a "Post a Photo" empty state and navigates to UploadPhotoPost', async () => {
      const { getByText } = await render(<FriendProfileScreen />);
      await waitFor(() => expect(getByText('No posts yet')).toBeTruthy());

      await fireEvent.press(getByText('Post a Photo'));
      await waitFor(() => expect(getByText('Post Progress Photo')).toBeTruthy());
      await fireEvent.press(getByText('Post Progress Photo'));

      expect(mockNavigate).toHaveBeenCalledWith('UploadPhotoPost', { mode: 'progress' });
    });

    it('skips straight to the picker (no menu) when tapping the avatar with no photo yet', async () => {
      mockUseFriendProfile.mockReturnValue({ data: { ...PROFILE, avatar_url: null }, isLoading: false });
      mockLaunchImageLibrary.mockResolvedValue({
        didCancel: false,
        assets: [{ uri: 'file:///tmp/picked.jpg', type: 'image/jpeg' }],
      });

      const { getByLabelText, queryByText } = await render(<FriendProfileScreen />);
      await waitFor(() => expect(getByLabelText('Profile photo')).toBeTruthy());

      await fireEvent.press(getByLabelText('Profile photo'));

      expect(queryByText('Choose New Photo')).toBeNull();
      await waitFor(() =>
        expect(mockNavigate).toHaveBeenCalledWith('AvatarPosition', {
          pickedUri: 'file:///tmp/picked.jpg',
          contentType: 'image/jpeg',
        }),
      );
    });

    it('offers a Choose New Photo / Reposition Photo menu when tapping an avatar that already has a photo', async () => {
      mockUseFriendProfile.mockReturnValue({
        data: { ...PROFILE, avatar_url: 'https://example.com/avatar.jpg' },
        isLoading: false,
      });

      const { getByLabelText, getByText } = await render(<FriendProfileScreen />);
      await waitFor(() => expect(getByLabelText('Profile photo')).toBeTruthy());
      await fireEvent.press(getByLabelText('Profile photo'));

      expect(getByText('Choose New Photo')).toBeTruthy();
      await fireEvent.press(getByText('Reposition Photo'));

      expect(mockNavigate).toHaveBeenCalledWith('AvatarPosition');
      expect(mockLaunchImageLibrary).not.toHaveBeenCalled();
    });

    it('navigates to AvatarPosition with the picked photo after choosing "Choose New Photo"', async () => {
      mockUseFriendProfile.mockReturnValue({
        data: { ...PROFILE, avatar_url: 'https://example.com/avatar.jpg' },
        isLoading: false,
      });
      mockLaunchImageLibrary.mockResolvedValue({
        didCancel: false,
        assets: [{ uri: 'file:///tmp/new.jpg', type: 'image/jpeg' }],
      });

      const { getByLabelText, getByText } = await render(<FriendProfileScreen />);
      await waitFor(() => expect(getByLabelText('Profile photo')).toBeTruthy());
      await fireEvent.press(getByLabelText('Profile photo'));
      await fireEvent.press(getByText('Choose New Photo'));

      await waitFor(() =>
        expect(mockNavigate).toHaveBeenCalledWith('AvatarPosition', {
          pickedUri: 'file:///tmp/new.jpg',
          contentType: 'image/jpeg',
        }),
      );
    });
  });

  it('shows a lock icon next to the name when the profile is private, and hides it when public', async () => {
    mockUseFriendProfile.mockReturnValue({ data: { ...PROFILE, is_private: true }, isLoading: false });
    const { getByLabelText, rerender, queryByLabelText } = await render(<FriendProfileScreen />);
    await waitFor(() => expect(getByLabelText('Private account')).toBeTruthy());

    mockUseFriendProfile.mockReturnValue({ data: { ...PROFILE, is_private: false }, isLoading: false });
    rerender(<FriendProfileScreen />);
    await waitFor(() => expect(queryByLabelText('Private account')).toBeNull());
  });
});
