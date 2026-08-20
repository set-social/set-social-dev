import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatScreen } from '../ChatScreen';

// The "enabled" gating behavior is covered in ChatScreen.test.tsx (which
// mocks the flag on) — this file forces it off to guard the gating ternary
// itself, independent of featureFlags.ts's real current default.
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { nutritionTracking: false } }));

function renderChatScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ChatScreen />
    </QueryClientProvider>,
  );
}

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
    useRoute: () => ({ params: {} }),
  };
});

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return { ...actual, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

jest.mock('../../../services/api/supabaseClient', () => ({
  supabase: {
    channel: jest.fn(() => ({ on: jest.fn(function (this: unknown) { return this; }), subscribe: jest.fn(function (this: unknown) { return this; }) })),
    removeChannel: jest.fn(),
  },
}));

jest.mock('../../../services/api/edgeFunctions', () => {
  const actual = jest.requireActual('../../../services/api/edgeFunctions');
  return { ...actual, sendChatMessage: jest.fn() };
});

jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: jest.fn(() => ({ data: { is_premium: true } })),
}));

jest.mock('../../../services/api/queries/chat', () => ({
  useConversation: jest.fn(() => ({ data: { id: 'conv-1' } })),
  useMessages: jest.fn(() => ({ data: [], isLoading: false })),
  useInvalidateMessages: jest.fn(() => jest.fn()),
  useClearChat: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
}));

jest.mock('../../../services/api/queries/foodLog', () => ({
  useUploadFoodPhoto: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  useSignedFoodPhotoUrls: jest.fn(() => ({ data: {} })),
}));

describe('ChatScreen with nutritionTracking disabled', () => {
  it('hides the food-photo attach button', async () => {
    const { queryByLabelText, getByText } = await renderChatScreen();
    await waitFor(() => expect(getByText('Ask Arnold')).toBeTruthy());
    expect(queryByLabelText('Attach a food photo')).toBeNull();
  });

  it('does not mention food photos in the empty state', async () => {
    const { getByText, queryByText } = await renderChatScreen();
    await waitFor(() => expect(getByText('Ask Arnold')).toBeTruthy());
    expect(queryByText(/Snap a photo/)).toBeNull();
  });
});
