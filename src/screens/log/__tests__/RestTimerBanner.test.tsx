import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { RestTimerBanner } from '../RestTimerBanner';
import { useActiveWorkoutStore } from '../../../store/activeWorkoutStore';
import { useRestTimerPreferenceStore } from '../../../store/restTimerPreferenceStore';

beforeEach(() => {
  jest.useFakeTimers();
  useActiveWorkoutStore.getState().reset();
  useRestTimerPreferenceStore.getState().setRestTimerEnabled(true);
});

afterEach(() => {
  // startRestTimer leaves a real setInterval running (by design — see
  // activeWorkoutStore's own comment on restIntervalId) — clear it so it
  // doesn't leak into the next test or leave Jest with an open handle.
  useActiveWorkoutStore.getState().reset();
  jest.useRealTimers();
});

describe('RestTimerBanner', () => {
  it('renders nothing when the rest timer preference is disabled', async () => {
    useRestTimerPreferenceStore.getState().setRestTimerEnabled(false);
    const { toJSON } = await render(<RestTimerBanner />);
    expect(toJSON()).toBeNull();
  });

  it('shows preset buttons when enabled and no timer is running', async () => {
    const { getByText } = await render(<RestTimerBanner />);
    expect(getByText('60s')).toBeTruthy();
    expect(getByText('90s')).toBeTruthy();
    expect(getByText('120s')).toBeTruthy();
  });

  it('starts a rest timer when a preset is pressed', async () => {
    const { getByText } = await render(<RestTimerBanner />);
    await fireEvent.press(getByText('90s'));
    expect(useActiveWorkoutStore.getState().restRunning).toBe(true);
    expect(useActiveWorkoutStore.getState().restSecondsRemaining).toBe(90);
  });

  it('does not render preset buttons once disabled mid-session, even with time already on the clock', async () => {
    useActiveWorkoutStore.getState().startRestTimer(90);
    useRestTimerPreferenceStore.getState().setRestTimerEnabled(false);
    const { toJSON } = await render(<RestTimerBanner />);
    expect(toJSON()).toBeNull();
  });
});
