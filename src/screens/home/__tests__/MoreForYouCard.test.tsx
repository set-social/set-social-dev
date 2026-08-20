import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { MoreForYouCard } from '../MoreForYouCard';

// MoreForYouCard's own logic under test is composition/dividers/empty-state
// — the self-gating children each have their own dedicated test files
// (GymProximityPill.test.tsx, RecoveryStoryLine.test.tsx) covering their
// real data/gating. Mocking them here to trivial visibility-reporting stubs
// keeps this file focused on what's actually new: does the card show/hide
// itself correctly as an aggregate of children it can't synchronously know
// the state of.
type StubProps = { asRow?: boolean; onVisibilityChange?: (visible: boolean) => void };

let mockGymPillVisible = false;
let mockRecoveryVisible = false;
let mockVitalsVisible = false;

jest.mock('../GymProximityPill', () => ({
  GymProximityPill: ({ onVisibilityChange }: StubProps) => {
    const { useEffect } = require('react');
    useEffect(() => onVisibilityChange?.(mockGymPillVisible), [onVisibilityChange]);
    const { Text } = require('react-native');
    return mockGymPillVisible ? <Text>Gym pill row</Text> : null;
  },
}));

jest.mock('../RecoveryStoryLine', () => ({
  RecoveryStoryLine: ({ onVisibilityChange }: StubProps) => {
    const { useEffect } = require('react');
    useEffect(() => onVisibilityChange?.(mockRecoveryVisible), [onVisibilityChange]);
    const { Text } = require('react-native');
    return mockRecoveryVisible ? <Text>Recovery row</Text> : null;
  },
}));

jest.mock('../VitalsTile', () => ({
  VitalsTile: ({ onVisibilityChange }: StubProps) => {
    const { useEffect } = require('react');
    useEffect(() => onVisibilityChange?.(mockVitalsVisible), [onVisibilityChange]);
    const { Text } = require('react-native');
    return mockVitalsVisible ? <Text>Vitals row</Text> : null;
  },
}));

const baseProps = {
  userId: 'user-1',
  focusModeEnabled: false,
  isWhoopConnected: true,
  activePatterns: [],
  onDismissPattern: jest.fn(),
  hasProgram: false,
  sessionsThisWeek: 0,
  weeklyTarget: 0,
  streak: 0,
  liveFriendWorkouts: [],
  onViewLiveNow: jest.fn(),
  friendsPostsCount: 0,
  friendsPostsLoading: false,
  friendsPostsError: false,
  onFriendsActivityViewAll: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGymPillVisible = false;
  mockRecoveryVisible = false;
  mockVitalsVisible = false;
});

describe('MoreForYouCard', () => {
  it('renders nothing when every possible row is empty', async () => {
    const { toJSON } = await render(<MoreForYouCard {...baseProps} />);
    // The wrapper stays mounted (display: none) rather than unmounting, so
    // its children can still report in — assert there's no visible content
    // instead of a null tree.
    expect(toJSON()?.props.style?.display).toBe('none');
  });

  it('shows the "More for you" header and Coach Insight rows once a pattern is active', async () => {
    const { getByText, queryByText } = await render(
      <MoreForYouCard
        {...baseProps}
        activePatterns={[
          {
            id: 'pat-1',
            pattern_type: 'rpe_creep',
            title: 'RPE creeping up on Squat',
            detail: 'Your last 3 sessions trended harder than planned.',
          } as never,
        ]}
      />,
    );
    await waitFor(() => expect(getByText('More for you')).toBeTruthy());
    expect(getByText('RPE creeping up on Squat')).toBeTruthy();
    expect(queryByText(/style.*none/)).toBeNull();
  });

  it('calls onDismissPattern with the pattern id when its dismiss button is pressed', async () => {
    const onDismissPattern = jest.fn();
    const { getByLabelText } = await render(
      <MoreForYouCard
        {...baseProps}
        activePatterns={[{ id: 'pat-1', pattern_type: 'rpe_creep', title: 'Title', detail: 'Detail' } as never]}
        onDismissPattern={onDismissPattern}
      />,
    );
    await waitFor(() => expect(getByLabelText('Dismiss insight')).toBeTruthy());
    await fireEvent.press(getByLabelText('Dismiss insight'));
    expect(onDismissPattern).toHaveBeenCalledWith('pat-1');
  });

  it('shows the weekly-progress row when there is an active program', async () => {
    const { getByText } = await render(
      <MoreForYouCard {...baseProps} hasProgram sessionsThisWeek={3} weeklyTarget={4} streak={5} />,
    );
    await waitFor(() => expect(getByText('On track this week')).toBeTruthy());
    expect(getByText('1 session left · 5 day streak')).toBeTruthy();
  });

  it('shows a Live Now summary row and calls onViewLiveNow on tap', async () => {
    const onViewLiveNow = jest.fn();
    const { getByText } = await render(
      <MoreForYouCard
        {...baseProps}
        onViewLiveNow={onViewLiveNow}
        liveFriendWorkouts={[
          { friend: { display_name: 'Jamie' }, workoutTitle: 'Push Day' } as never,
        ]}
      />,
    );
    await waitFor(() => expect(getByText('Jamie is training live')).toBeTruthy());
    await fireEvent.press(getByText('Jamie is training live'));
    expect(onViewLiveNow).toHaveBeenCalled();
  });

  it('hides the Live Now and Friends Activity rows in Focus Mode', async () => {
    const { queryByText } = await render(
      <MoreForYouCard
        {...baseProps}
        focusModeEnabled
        liveFriendWorkouts={[{ friend: { display_name: 'Jamie' }, workoutTitle: 'Push Day' } as never]}
        friendsPostsCount={2}
      />,
    );
    await waitFor(() => {});
    expect(queryByText(/is training live/)).toBeNull();
    expect(queryByText(/new posts from friends/)).toBeNull();
  });

  it('hides the Friends Activity row while loading or errored, even with a nonzero count', async () => {
    const { queryByText: queryLoading } = await render(
      <MoreForYouCard {...baseProps} friendsPostsCount={2} friendsPostsLoading />,
    );
    expect(queryLoading(/new posts from friends/)).toBeNull();

    const { queryByText: queryError } = await render(
      <MoreForYouCard {...baseProps} friendsPostsCount={2} friendsPostsError />,
    );
    expect(queryError(/new posts from friends/)).toBeNull();
  });

  it('shows the vitals (weight/consistency/streak) row once it reports visible', async () => {
    mockVitalsVisible = true;
    const { getByText } = await render(<MoreForYouCard {...baseProps} />);
    await waitFor(() => expect(getByText('More for you')).toBeTruthy());
    expect(getByText('Vitals row')).toBeTruthy();
  });
});
