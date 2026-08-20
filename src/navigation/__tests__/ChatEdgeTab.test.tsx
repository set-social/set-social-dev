import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ChatEdgeTab } from '../ChatEdgeTab';

// GestureDetector (used for the swipe-up gesture) requires a
// GestureHandlerRootView ancestor — normally provided once at the real app
// root (App.tsx), which doesn't exist in an isolated test render tree.
function renderHandle() {
  return render(
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ChatEdgeTab />
    </GestureHandlerRootView>,
  );
}

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ navigate: mockNavigate }) };
});

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return { ...actual, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

let mockHasUnread = false;

jest.mock('../../store/chatUiStore', () => ({
  useChatUiStore: (selector: (state: { hasUnread: boolean }) => unknown) => selector({ hasUnread: mockHasUnread }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockHasUnread = false;
});

describe('ChatEdgeTab', () => {
  it('opens Chat on tap — the same trigger the swipe-up gesture calls', async () => {
    const { getByLabelText } = await renderHandle();
    await fireEvent.press(getByLabelText('Chat with Arnold'));
    expect(mockNavigate).toHaveBeenCalledWith('Chat', undefined);
  });

  it('exposes an accessible button with a hint that a drag also works', async () => {
    const { getByLabelText } = await renderHandle();
    const button = getByLabelText('Chat with Arnold');
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityHint).toMatch(/drag up/i);
  });

  it('dims the line by default and brightens it when there is an unread message', async () => {
    const { getByTestId, rerender } = await renderHandle();
    expect(getByTestId('chat-drag-line').props.style.opacity).toBe(0.55);

    mockHasUnread = true;
    await rerender(
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ChatEdgeTab />
      </GestureHandlerRootView>,
    );
    expect(getByTestId('chat-drag-line').props.style.opacity).toBe(1);
  });
});
