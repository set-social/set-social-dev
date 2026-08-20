import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatScreen } from '../ChatScreen';
import { useChatUiStore } from '../../../store/chatUiStore';

// ChatScreen calls useQueryClient() directly (not via a mocked query-file
// hook, unlike everything else it reads through services/api/queries/chat)
// — the only spot in this test that needs a real provider in the tree.
function renderChatScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ChatScreen />
    </QueryClientProvider>,
  );
}

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();

const mockRouteParams: { openFoodLog?: boolean } = {};
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate }),
    useRoute: () => ({ params: mockRouteParams }),
  };
});

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return { ...actual, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

// nutritionTracking is off by default (see featureFlags.ts) — forced on
// here since this whole file, including the "photo food logging" describe
// block below, is specifically exercising that feature's code path.
jest.mock('../../../config/featureFlags', () => ({
  featureFlags: { nutritionTracking: true },
}));

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockChannelStub = {
  on: jest.fn(function (this: unknown) {
    return this;
  }),
  subscribe: jest.fn(function (this: unknown) {
    return this;
  }),
};

jest.mock('../../../services/api/supabaseClient', () => ({
  supabase: {
    channel: jest.fn(() => mockChannelStub),
    removeChannel: jest.fn(),
  },
}));

const mockSendChatMessage = jest.fn();
jest.mock('../../../services/api/edgeFunctions', () => {
  const actual = jest.requireActual('../../../services/api/edgeFunctions');
  return { ...actual, sendChatMessage: (...args: unknown[]) => mockSendChatMessage(...args) };
});

const mockUseProfile = jest.fn();
jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: (...args: unknown[]) => mockUseProfile(...args),
}));

const mockUseConversation = jest.fn();
const mockUseMessages = jest.fn();
const mockInvalidateMessages = jest.fn();
const mockClearChatMutateAsync = jest.fn();

jest.mock('../../../services/api/queries/chat', () => ({
  useConversation: (...args: unknown[]) => mockUseConversation(...args),
  useMessages: (...args: unknown[]) => mockUseMessages(...args),
  useInvalidateMessages: jest.fn(() => mockInvalidateMessages),
  useClearChat: jest.fn(() => ({ mutateAsync: mockClearChatMutateAsync, isPending: false })),
}));

const mockUploadFoodPhotoMutateAsync = jest.fn();
const mockUseSignedFoodPhotoUrls = jest.fn();
jest.mock('../../../services/api/queries/foodLog', () => ({
  useUploadFoodPhoto: jest.fn(() => ({ mutateAsync: mockUploadFoodPhotoMutateAsync, isPending: false })),
  useSignedFoodPhotoUrls: (...args: unknown[]) => mockUseSignedFoodPhotoUrls(...args),
}));

const mockLaunchCamera = jest.fn();
const mockLaunchImageLibrary = jest.fn();
jest.mock('react-native-image-picker', () => ({
  launchCamera: (...args: unknown[]) => mockLaunchCamera(...args),
  launchImageLibrary: (...args: unknown[]) => mockLaunchImageLibrary(...args),
}));

// FoodEstimateCard has its own dedicated test file — stubbed here so
// ChatScreen's tests only assert that the right message gets routed to it.
jest.mock('../FoodEstimateCard', () => ({
  FoodEstimateCard: ({ foodLogEntryId }: { foodLogEntryId: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text>{`FoodEstimateCard:${foodLogEntryId}`}</Text>;
  },
}));

// Timestamped "now" (not a fixed past date) so the "used this month" count
// this exercises stays correct regardless of when the suite actually runs.
const NOW_ISO = new Date().toISOString();

const MESSAGES = [
  { id: 'm1', role: 'user' as const, content: 'How much should I squat this week?', created_at: NOW_ISO },
  { id: 'm2', role: 'assistant' as const, content: 'Based on your recent sessions, aim for 3x5 at RPE 8.', created_at: NOW_ISO },
];

beforeEach(() => {
  jest.clearAllMocks();
  useChatUiStore.setState({ streamingBuffer: '', hasUnread: false });
  mockUseConversation.mockReturnValue({ data: { id: 'conv-1' } });
  mockUseMessages.mockReturnValue({ data: MESSAGES, isLoading: false });
  mockClearChatMutateAsync.mockResolvedValue(undefined);
  mockUseProfile.mockReturnValue({ data: { is_premium: true } });
  mockUseSignedFoodPhotoUrls.mockReturnValue({ data: {} });
});

describe('ChatScreen', () => {
  it('renders the conversation history', async () => {
    const { getByText } = await renderChatScreen();
    await waitFor(() => expect(getByText('How much should I squat this week?')).toBeTruthy());
    expect(getByText('Based on your recent sessions, aim for 3x5 at RPE 8.')).toBeTruthy();
  });

  it('labels the athlete\'s messages "You" and the assistant\'s "Arnold"', async () => {
    const { getByText, getAllByText } = await renderChatScreen();
    await waitFor(() => expect(getByText('How much should I squat this week?')).toBeTruthy());
    expect(getAllByText('You')).toHaveLength(1);
    expect(getAllByText('Arnold')).toHaveLength(2); // header title + the one assistant message
  });

  it('shows a Beta pip next to the Arnold header title', async () => {
    const { getByText } = await renderChatScreen();
    await waitFor(() => expect(getByText('How much should I squat this week?')).toBeTruthy());
    expect(getByText('BETA')).toBeTruthy();
  });

  it('offers Clear Chat from the options menu and clears after confirming', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const confirm = buttons?.find(b => b.text === 'Clear');
      confirm?.onPress?.();
    });

    const { getByLabelText, getByText } = await renderChatScreen();
    await waitFor(() => expect(getByText('How much should I squat this week?')).toBeTruthy());

    await fireEvent.press(getByLabelText('Chat options'));
    await fireEvent.press(getByText('Clear Chat'));

    expect(alertSpy).toHaveBeenCalled();
    await waitFor(() => expect(mockClearChatMutateAsync).toHaveBeenCalled());

    alertSpy.mockRestore();
  });

  it('does not clear when the confirmation is cancelled', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByLabelText, getByText } = await renderChatScreen();
    await waitFor(() => expect(getByText('How much should I squat this week?')).toBeTruthy());

    await fireEvent.press(getByLabelText('Chat options'));
    await fireEvent.press(getByText('Clear Chat'));

    expect(mockClearChatMutateAsync).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('shows an alert if clearing the chat fails', async () => {
    mockClearChatMutateAsync.mockRejectedValue(new Error('Network error'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((title, _message, buttons) => {
      if (title === 'Clear this chat?') {
        const confirm = buttons?.find(b => b.text === 'Clear');
        confirm?.onPress?.();
      }
    });

    const { getByLabelText, getByText } = await renderChatScreen();
    await waitFor(() => expect(getByText('How much should I squat this week?')).toBeTruthy());

    await fireEvent.press(getByLabelText('Chat options'));
    await fireEvent.press(getByText('Clear Chat'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Could not clear chat', 'Network error'));
    alertSpy.mockRestore();
  });

  it('wires the header\'s collapse chevron to navigation.goBack', async () => {
    const { getByLabelText, getByText } = await renderChatScreen();
    await waitFor(() => expect(getByText('How much should I squat this week?')).toBeTruthy());

    await fireEvent.press(getByLabelText('Collapse chat'));
    expect(mockGoBack).toHaveBeenCalled();
  });

  describe('free-tier message cap', () => {
    beforeEach(() => {
      mockUseProfile.mockReturnValue({ data: { is_premium: false } });
    });

    it('shows how many of the free messages have been used this month', async () => {
      const { getByText } = await renderChatScreen();
      // MESSAGES has one 'user' row timestamped "now".
      await waitFor(() => expect(getByText('1 of 3 free messages used this month')).toBeTruthy());
    });

    it('does not show the free-tier caption for a Pro account', async () => {
      mockUseProfile.mockReturnValue({ data: { is_premium: true } });
      const { queryByText } = await renderChatScreen();
      await waitFor(() => expect(queryByText(/free messages used/)).toBeNull());
    });

    it('redirects to the paywall when the server reports the free limit reached', async () => {
      const { EdgeFunctionError } = jest.requireActual('../../../services/api/edgeFunctions');
      mockSendChatMessage.mockRejectedValue(
        new EdgeFunctionError("You've used your 3 free Arnold messages this month.", 'free_limit_reached'),
      );

      const { getByPlaceholderText, getByText } = await renderChatScreen();
      await waitFor(() => expect(getByText('How much should I squat this week?')).toBeTruthy());

      // fireEvent.changeText doesn't reliably reach this multiline
      // TextField in this RN/RNTL combo — invoking onChangeText directly
      // (still act()-wrapped) is the pattern that actually works here.
      await act(() => {
        getByPlaceholderText('Ask Arnold...').props.onChangeText('One more question');
      });
      await fireEvent.press(getByText('Send'));

      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Paywall', { trigger: 'ai_chat' }));
      // The draft isn't lost — it's handed back to the input rather than
      // discarded, since the failure wasn't the athlete's fault.
      expect(getByPlaceholderText('Ask Arnold...').props.value).toBe('One more question');
    });

    it('skips the network call and goes straight to the paywall once already at the cap', async () => {
      mockUseMessages.mockReturnValue({
        data: [
          { id: 'm1', role: 'user', content: 'q1', created_at: NOW_ISO },
          { id: 'm2', role: 'user', content: 'q2', created_at: NOW_ISO },
          { id: 'm3', role: 'user', content: 'q3', created_at: NOW_ISO },
        ],
        isLoading: false,
      });

      const { getByPlaceholderText, getByText } = await renderChatScreen();
      await waitFor(() => expect(getByText("You've used all your free messages this month — upgrade for unlimited access to Arnold")).toBeTruthy());

      await act(() => {
        getByPlaceholderText('Upgrade to keep chatting…').props.onChangeText('One more');
      });
      await fireEvent.press(getByText('Upgrade'));

      expect(mockNavigate).toHaveBeenCalledWith('Paywall', { trigger: 'ai_chat' });
      expect(mockSendChatMessage).not.toHaveBeenCalled();
    });
  });

  describe('photo food logging', () => {
    it('stages a photo from the attach sheet without sending it yet, capped to a vision-friendly size', async () => {
      mockLaunchCamera.mockResolvedValue({ didCancel: false, assets: [{ uri: 'file://photo.jpg', type: 'image/jpeg' }] });

      const { getByLabelText, getByText, queryByText } = await renderChatScreen();
      await waitFor(() => expect(getByText('How much should I squat this week?')).toBeTruthy());

      await fireEvent.press(getByLabelText('Attach a food photo'));
      await fireEvent.press(getByText('Take Photo'));

      await waitFor(() => expect(mockLaunchCamera).toHaveBeenCalledWith(expect.objectContaining({ maxWidth: 1568, maxHeight: 1568 })));
      expect(queryByText(/Add a note below/)).toBeTruthy();
      expect(mockUploadFoodPhotoMutateAsync).not.toHaveBeenCalled();
      expect(mockSendChatMessage).not.toHaveBeenCalled();
    });

    it('sends a staged photo together with a note typed afterward', async () => {
      mockLaunchCamera.mockResolvedValue({ didCancel: false, assets: [{ uri: 'file://photo.jpg', type: 'image/jpeg' }] });
      mockUploadFoodPhotoMutateAsync.mockResolvedValue('user-1/abc.jpg');
      mockSendChatMessage.mockResolvedValue({ message_id: 'm-new' });

      const { getByLabelText, getByText, getByPlaceholderText } = await renderChatScreen();
      await waitFor(() => expect(getByText('How much should I squat this week?')).toBeTruthy());

      await fireEvent.press(getByLabelText('Attach a food photo'));
      await fireEvent.press(getByText('Take Photo'));
      await waitFor(() => expect(mockLaunchCamera).toHaveBeenCalled());

      await fireEvent.changeText(getByPlaceholderText('Add a note (optional)…'), 'log this for breakfast');
      await fireEvent.press(getByText('Send'));

      await waitFor(() =>
        expect(mockUploadFoodPhotoMutateAsync).toHaveBeenCalledWith({ uri: 'file://photo.jpg', contentType: 'image/jpeg' }),
      );
      await waitFor(() =>
        expect(mockSendChatMessage).toHaveBeenCalledWith(
          'conv-1',
          'log this for breakfast',
          expect.any(String),
          'user-1/abc.jpg',
        ),
      );
    });

    it('sends a staged photo with no note when Send is pressed right away', async () => {
      mockLaunchCamera.mockResolvedValue({ didCancel: false, assets: [{ uri: 'file://photo.jpg', type: 'image/jpeg' }] });
      mockUploadFoodPhotoMutateAsync.mockResolvedValue('user-1/abc.jpg');
      mockSendChatMessage.mockResolvedValue({ message_id: 'm-new' });

      const { getByLabelText, getByText } = await renderChatScreen();
      await waitFor(() => expect(getByText('How much should I squat this week?')).toBeTruthy());

      await fireEvent.press(getByLabelText('Attach a food photo'));
      await fireEvent.press(getByText('Take Photo'));
      await waitFor(() => expect(mockLaunchCamera).toHaveBeenCalled());
      await fireEvent.press(getByText('Send'));

      await waitFor(() =>
        expect(mockSendChatMessage).toHaveBeenCalledWith('conv-1', '', expect.any(String), 'user-1/abc.jpg'),
      );
    });

    it('lets the athlete remove a staged photo before sending', async () => {
      mockLaunchCamera.mockResolvedValue({ didCancel: false, assets: [{ uri: 'file://photo.jpg', type: 'image/jpeg' }] });

      const { getByLabelText, getByText, queryByText } = await renderChatScreen();
      await waitFor(() => expect(getByText('How much should I squat this week?')).toBeTruthy());

      await fireEvent.press(getByLabelText('Attach a food photo'));
      await fireEvent.press(getByText('Take Photo'));
      await waitFor(() => expect(queryByText(/Add a note below/)).toBeTruthy());

      await fireEvent.press(getByLabelText('Remove photo'));
      expect(queryByText(/Add a note below/)).toBeNull();
    });

    it('picks from the library instead of the camera when that option is chosen', async () => {
      mockLaunchImageLibrary.mockResolvedValue({ didCancel: false, assets: [{ uri: 'file://library.jpg', type: 'image/jpeg' }] });

      const { getByLabelText, getByText } = await renderChatScreen();
      await waitFor(() => expect(getByText('How much should I squat this week?')).toBeTruthy());

      await fireEvent.press(getByLabelText('Attach a food photo'));
      await fireEvent.press(getByText('Choose from Library'));

      await waitFor(() => expect(mockLaunchImageLibrary).toHaveBeenCalled());
      expect(mockLaunchCamera).not.toHaveBeenCalled();
    });

    it('does nothing when the picker is cancelled', async () => {
      mockLaunchCamera.mockResolvedValue({ didCancel: true });

      const { getByLabelText, getByText, queryByText } = await renderChatScreen();
      await waitFor(() => expect(getByText('How much should I squat this week?')).toBeTruthy());

      await fireEvent.press(getByLabelText('Attach a food photo'));
      await fireEvent.press(getByText('Take Photo'));

      await waitFor(() => expect(mockLaunchCamera).toHaveBeenCalled());
      expect(queryByText(/Add a note below/)).toBeNull();
      expect(mockUploadFoodPhotoMutateAsync).not.toHaveBeenCalled();
      expect(mockSendChatMessage).not.toHaveBeenCalled();
    });

    it('renders a FoodEstimateCard for a message carrying a food_log_entry_id', async () => {
      mockUseMessages.mockReturnValue({
        data: [
          { id: 'm1', role: 'user', content: null, photo_path: 'user-1/meal.jpg', created_at: NOW_ISO },
          { id: 'm2', role: 'assistant', content: 'Here is my estimate.', food_log_entry_id: 'food-1', created_at: NOW_ISO },
        ],
        isLoading: false,
      });

      const { getByText } = await renderChatScreen();
      await waitFor(() => expect(getByText('FoodEstimateCard:food-1')).toBeTruthy());
    });

    it('renders a photo thumbnail for a message with a signed photo url', async () => {
      mockUseMessages.mockReturnValue({
        data: [{ id: 'm1', role: 'user', content: null, photo_path: 'user-1/meal.jpg', created_at: NOW_ISO }],
        isLoading: false,
      });
      mockUseSignedFoodPhotoUrls.mockReturnValue({ data: { 'user-1/meal.jpg': 'https://signed.example/meal.jpg' } });

      const { getByTestId } = await renderChatScreen();
      await waitFor(() => expect(getByTestId('chat-photo-thumbnail').props.source.uri).toBe('https://signed.example/meal.jpg'));
    });
  });
});
