import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PostDetailScreen } from '../PostDetailScreen';

// GestureDetector (used for double-tap-to-like) requires a
// GestureHandlerRootView ancestor — normally provided once at the real
// app root (App.tsx), which doesn't exist in an isolated test render tree.
function renderScreen() {
  return render(<PostDetailScreen />, {
    wrapper: ({ children }) => <GestureHandlerRootView style={{ flex: 1 }}>{children}</GestureHandlerRootView>,
  });
}

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, canGoBack: () => false }),
    useRoute: () => ({ params: { postId: 'post-1' } }),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUsePost = jest.fn();

jest.mock('../../../services/api/queries/posts', () => {
  const actual = jest.requireActual('../../../services/api/queries/posts');
  return {
    ...actual,
    usePost: (...args: unknown[]) => mockUsePost(...args),
    useUpdatePost: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
    useDeletePost: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
    useSignedPhotoUrls: jest.fn(() => ({
      data: {
        'user-2/friends/progress.jpg': 'https://signed/progress.jpg',
        'user-2/friends/before.jpg': 'https://signed/before.jpg',
        'user-2/friends/after.jpg': 'https://signed/after.jpg',
      },
    })),
  };
});

jest.mock('../../../services/api/queries/community', () => ({
  useFriendProfile: jest.fn(() => ({ data: { display_name: 'Alex B.', avatar_url: null } })),
  useBlockUser: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
}));

jest.mock('../../../services/api/queries/reports', () => ({
  useCreateReport: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
}));

const mockUseComments = jest.fn();
const mockCreateCommentMutateAsync = jest.fn();
const mockDeleteCommentMutate = jest.fn();

const mockUseLikes = jest.fn();
const mockToggleLikeMutate = jest.fn();

jest.mock('../../../services/api/queries/likes', () => ({
  useLikes: (...args: unknown[]) => mockUseLikes(...args),
  useToggleLike: jest.fn(() => ({ mutate: mockToggleLikeMutate, isPending: false })),
}));

jest.mock('../../../services/api/queries/comments', () => ({
  useComments: (...args: unknown[]) => mockUseComments(...args),
  useCreateComment: jest.fn(() => ({ mutateAsync: mockCreateCommentMutateAsync, isPending: false })),
  useDeleteComment: jest.fn(() => ({ mutate: mockDeleteCommentMutate })),
}));

const PROGRESS_POST = {
  id: 'post-1',
  user_id: 'user-2',
  post_type: 'progress_photo' as const,
  visibility: 'friends' as const,
  caption: 'Feeling strong',
  photo_path: 'user-2/friends/progress.jpg',
  before_photo_path: null,
  after_photo_path: null,
  created_at: '2026-01-01T00:00:00.000Z',
};

const BEFORE_AFTER_POST = {
  id: 'post-2',
  user_id: 'user-2',
  post_type: 'before_after_photo' as const,
  visibility: 'friends' as const,
  caption: null,
  photo_path: null,
  before_photo_path: 'user-2/friends/before.jpg',
  after_photo_path: 'user-2/friends/after.jpg',
  created_at: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseComments.mockReturnValue({ data: [] });
  mockUseLikes.mockReturnValue({ data: { count: 0, likedByMe: false } });
});

describe('PostDetailScreen', () => {
  it('renders a progress-photo post with its caption', async () => {
    mockUsePost.mockReturnValue({ data: PROGRESS_POST, isLoading: false });

    const { getByText, getByLabelText } = await renderScreen();

    await waitFor(() => expect(getByText('Feeling strong')).toBeTruthy());
    expect(getByLabelText('Progress photo')).toBeTruthy();
    // Full-detail view shows the complete photo scaled down, not cropped —
    // cropping to fill is correct for the feed grid, not here.
    expect(getByLabelText('Progress photo').props.resizeMode).toBe('contain');
  });

  it('renders a before/after post with two images', async () => {
    mockUsePost.mockReturnValue({ data: BEFORE_AFTER_POST, isLoading: false });

    const { getByLabelText } = await renderScreen();

    await waitFor(() => expect(getByLabelText('Before photo')).toBeTruthy());
    expect(getByLabelText('After photo')).toBeTruthy();
    expect(getByLabelText('Before photo').props.resizeMode).toBe('contain');
    expect(getByLabelText('After photo').props.resizeMode).toBe('contain');
  });

  it('shows the VisibilityBadge only when viewing your own post', async () => {
    mockUsePost.mockReturnValue({ data: { ...PROGRESS_POST, user_id: 'user-1' }, isLoading: false });

    const { getByText } = await renderScreen();
    await waitFor(() => expect(getByText('👥 Friends')).toBeTruthy());
  });

  it('does not show a VisibilityBadge when viewing a friend\'s post', async () => {
    mockUsePost.mockReturnValue({ data: PROGRESS_POST, isLoading: false });

    const { queryByText } = await renderScreen();
    await waitFor(() => expect(queryByText('👥 Friends')).toBeNull());
  });

  it('renders existing comments with author and body', async () => {
    mockUsePost.mockReturnValue({ data: PROGRESS_POST, isLoading: false });
    mockUseComments.mockReturnValue({
      data: [
        {
          id: 'comment-1',
          post_id: 'post-1',
          user_id: 'user-3',
          body: 'Great progress!',
          created_at: '2026-01-01T00:00:00.000Z',
          displayName: 'Sam K.',
          avatarUrl: null,
        },
      ],
    });

    const { getByText } = await renderScreen();
    await waitFor(() => expect(getByText('Sam K.')).toBeTruthy());
    expect(getByText('Great progress!')).toBeTruthy();
  });

  it("navigates to a commenter's profile when their avatar/name is tapped", async () => {
    mockUsePost.mockReturnValue({ data: PROGRESS_POST, isLoading: false });
    mockUseComments.mockReturnValue({
      data: [
        {
          id: 'comment-1',
          post_id: 'post-1',
          user_id: 'user-3',
          body: 'Great progress!',
          created_at: '2026-01-01T00:00:00.000Z',
          displayName: 'Sam K.',
          avatarUrl: null,
        },
      ],
    });

    const { getByLabelText } = await renderScreen();
    await waitFor(() => expect(getByLabelText("View Sam K.'s profile")).toBeTruthy());
    await fireEvent.press(getByLabelText("View Sam K.'s profile"));

    expect(mockNavigate).toHaveBeenCalledWith('FriendProfile', { userId: 'user-3' });
  });

  it('does not navigate anywhere for tapping your own comment', async () => {
    mockUsePost.mockReturnValue({ data: PROGRESS_POST, isLoading: false });
    mockUseComments.mockReturnValue({
      data: [
        {
          id: 'comment-1',
          post_id: 'post-1',
          user_id: 'user-1',
          body: 'My own comment',
          created_at: '2026-01-01T00:00:00.000Z',
          displayName: 'Me',
          avatarUrl: null,
        },
      ],
    });

    const { getByLabelText } = await renderScreen();
    await waitFor(() => expect(getByLabelText("View Me's profile")).toBeTruthy());
    await fireEvent.press(getByLabelText("View Me's profile"));

    expect(mockNavigate).not.toHaveBeenCalledWith('FriendProfile', expect.anything());
  });

  it('posts a new comment and clears the composer', async () => {
    mockUsePost.mockReturnValue({ data: PROGRESS_POST, isLoading: false });
    mockCreateCommentMutateAsync.mockResolvedValue(undefined);

    const { getByPlaceholderText, getByText, getAllByText } = await renderScreen();
    await waitFor(() => expect(getByText('Feeling strong')).toBeTruthy());

    const input = getByPlaceholderText('Add a comment...');
    await fireEvent.changeText(input, 'Nice work!');
    // "Post" also appears as the screen's own Header title, so scope to the
    // composer's button specifically (the second "Post" text in the tree).
    const postButtons = getAllByText('Post');
    await fireEvent.press(postButtons[postButtons.length - 1]);

    expect(mockCreateCommentMutateAsync).toHaveBeenCalledWith('Nice work!');
  });

  it('deletes a comment after confirming, only when the viewer owns it or the post', async () => {
    mockUsePost.mockReturnValue({ data: { ...PROGRESS_POST, user_id: 'user-1' }, isLoading: false });
    mockUseComments.mockReturnValue({
      data: [
        {
          id: 'comment-1',
          post_id: 'post-1',
          user_id: 'user-3',
          body: 'Nice!',
          created_at: '2026-01-01T00:00:00.000Z',
          displayName: 'Sam K.',
          avatarUrl: null,
        },
      ],
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const deleteButton = buttons?.find(b => b.text === 'Delete');
      deleteButton?.onPress?.();
    });

    const { getByLabelText } = await renderScreen();
    await waitFor(() => expect(getByLabelText('Delete comment')).toBeTruthy());
    await fireEvent.press(getByLabelText('Delete comment'));

    expect(mockDeleteCommentMutate).toHaveBeenCalledWith('comment-1');
    alertSpy.mockRestore();
  });

  it('shows the like count and prompts to be first when there are none', async () => {
    mockUsePost.mockReturnValue({ data: PROGRESS_POST, isLoading: false });
    mockUseLikes.mockReturnValue({ data: { count: 0, likedByMe: false } });

    const { getByText } = await renderScreen();
    await waitFor(() => expect(getByText('Be the first to like this')).toBeTruthy());
  });

  it('shows a pluralized like count when liked', async () => {
    mockUsePost.mockReturnValue({ data: PROGRESS_POST, isLoading: false });
    mockUseLikes.mockReturnValue({ data: { count: 3, likedByMe: true } });

    const { getByText, getByLabelText } = await renderScreen();
    await waitFor(() => expect(getByText('3 likes')).toBeTruthy());
    expect(getByLabelText('Unlike')).toBeTruthy();
  });

  it('toggles the like via the persistent button', async () => {
    mockUsePost.mockReturnValue({ data: PROGRESS_POST, isLoading: false });
    mockUseLikes.mockReturnValue({ data: { count: 1, likedByMe: false } });

    const { getByLabelText } = await renderScreen();
    await waitFor(() => expect(getByLabelText('Like')).toBeTruthy());
    await fireEvent.press(getByLabelText('Like'));

    expect(mockToggleLikeMutate).toHaveBeenCalledWith(false);
  });
});
