import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { LiveNowRail } from '../LiveNowRail';
import type { LiveFriendWorkout } from '../../../services/api/queries/liveWorkouts';
import type { PublicProfile } from '../../../services/api/queries/community';

jest.mock('../../../hooks/useUnitPreference', () => ({
  useUnitPreference: () => 'kg',
}));

const FRIEND: PublicProfile = {
  id: 'friend-1',
  display_name: 'Sam K.',
  avatar_url: null,
  avatar_focal_x: 0.5,
  avatar_focal_y: 0.5,
  handle: null,
  bio: null,
  hide_stats_from_friends: false,
  hide_photos_from_friends: false,
  is_private: false,
  is_premium: false,
};

const WORKOUT: LiveFriendWorkout = {
  friend: FRIEND,
  workoutLogId: 'log-1',
  startedAt: new Date().toISOString(),
  workoutTitle: 'Push Day',
  exerciseId: 'ex-1',
  exerciseName: 'Bench Press',
  setsDone: 2,
  bestLoadKg: 100,
  bestReps: 5,
  prLoadKg: 110,
  prReps: 5,
  atYourGym: false,
};

describe('LiveNowRail', () => {
  it('opens the detail sheet on card tap, then navigates to the profile (and closes the sheet) when the avatar/name is tapped', async () => {
    const onViewProfile = jest.fn();
    const { getByLabelText, getByText, queryByText } = await render(
      <LiveNowRail workouts={[WORKOUT]} onViewProfile={onViewProfile} />,
    );

    await fireEvent.press(getByLabelText('Sam K., live now on Bench Press'));
    await waitFor(() => expect(getByText("Sam K.'s session")).toBeTruthy());

    await fireEvent.press(getByLabelText("View Sam K.'s profile"));

    expect(onViewProfile).toHaveBeenCalledWith('friend-1');
    await waitFor(() => expect(queryByText("Sam K.'s session")).toBeNull());
  });
});
