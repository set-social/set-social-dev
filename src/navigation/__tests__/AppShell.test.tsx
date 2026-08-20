import React from 'react';
import { act, render } from '@testing-library/react-native';
import { AppShell } from '../AppShell';

// MainTabs itself (every tab stack, auth store, profile/notification
// queries) isn't the point of this test — only that AppShell picks the
// right FAB for whichever tab MainTabs reports as active. Mocked down to
// just exposing the onActiveTabChange callback it would normally call.
let capturedOnActiveTabChange: ((tab: string, focusedScreenName?: string) => void) | undefined;

jest.mock('../MainTabs', () => ({
  MainTabs: ({ onActiveTabChange }: { onActiveTabChange: (tab: string, focusedScreenName?: string) => void }) => {
    capturedOnActiveTabChange = onActiveTabChange;
    return null;
  },
}));

jest.mock('../PostFab', () => ({
  PostFab: () => {
    const { Text } = jest.requireActual('react-native');
    return <Text>PostFab</Text>;
  },
}));

describe('AppShell', () => {
  it('shows no FAB by default and on tabs other than the Social feed', async () => {
    const { queryByText } = await render(<AppShell />);
    expect(queryByText('PostFab')).toBeNull();

    await act(async () => capturedOnActiveTabChange?.('ProgramsTab'));
    expect(queryByText('PostFab')).toBeNull();
  });

  it('shows the post FAB on the Social tab feed, and hides it on leaving it', async () => {
    const { queryByText } = await render(<AppShell />);

    await act(async () => capturedOnActiveTabChange?.('CommunityTab', 'Posts'));
    expect(queryByText('PostFab')).toBeTruthy();

    await act(async () => capturedOnActiveTabChange?.('TodayTab'));
    expect(queryByText('PostFab')).toBeNull();
  });

  it('hides the post FAB while in a DM conversation, since it already has its own send button', async () => {
    const { queryByText } = await render(<AppShell />);

    await act(async () => capturedOnActiveTabChange?.('CommunityTab', 'Conversation'));
    expect(queryByText('PostFab')).toBeNull();

    await act(async () => capturedOnActiveTabChange?.('CommunityTab', 'Posts'));
    expect(queryByText('PostFab')).toBeTruthy();
  });

  it('shows no FAB on other Social-tab screens (e.g. a friend profile)', async () => {
    const { queryByText } = await render(<AppShell />);

    await act(async () => capturedOnActiveTabChange?.('CommunityTab', 'FriendProfile'));
    expect(queryByText('PostFab')).toBeNull();
  });
});
