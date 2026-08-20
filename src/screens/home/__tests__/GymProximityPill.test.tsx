import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { GymProximityPill } from '../GymProximityPill';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ navigate: mockNavigate }) };
});

const mockUseMyCheckin = jest.fn();
const mockUseNearbyCheckins = jest.fn();

jest.mock('../../../services/api/queries/location', () => ({
  useMyCheckin: (...args: unknown[]) => mockUseMyCheckin(...args),
  useNearbyCheckins: (...args: unknown[]) => mockUseNearbyCheckins(...args),
}));

const CHECKED_IN = { checkedInAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString() };

beforeEach(() => {
  jest.clearAllMocks();
  mockUseMyCheckin.mockReturnValue({ data: null, isLoading: false });
  mockUseNearbyCheckins.mockReturnValue({ data: [], isLoading: false });
});

describe('GymProximityPill', () => {
  it('renders nothing when the viewer has no active check-in', async () => {
    const { toJSON } = await render(<GymProximityPill userId="user-1" />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when checked in but no one is nearby', async () => {
    mockUseMyCheckin.mockReturnValue({ data: CHECKED_IN, isLoading: false });
    mockUseNearbyCheckins.mockReturnValue({ data: [], isLoading: false });

    const { toJSON } = await render(<GymProximityPill userId="user-1" />);
    expect(toJSON()).toBeNull();
  });

  it('only queries nearby check-ins once the viewer is checked in', async () => {
    mockUseMyCheckin.mockReturnValue({ data: null, isLoading: false });
    await render(<GymProximityPill userId="user-1" />);
    expect(mockUseNearbyCheckins).toHaveBeenCalledWith(false);
  });

  it('pluralizes correctly and navigates to At My Gym on tap', async () => {
    mockUseMyCheckin.mockReturnValue({ data: CHECKED_IN, isLoading: false });
    mockUseNearbyCheckins.mockReturnValue({
      data: [
        { id: 'f1', display_name: 'Alex', distanceMeters: 10 },
        { id: 'f2', display_name: 'Sam', distanceMeters: 40 },
      ],
      isLoading: false,
    });

    const { getByLabelText } = await render(<GymProximityPill userId="user-1" />);
    await waitFor(() => expect(getByLabelText('2 friends checked in nearby')).toBeTruthy());

    await fireEvent.press(getByLabelText('2 friends checked in nearby'));
    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'CommunityTab', params: { screen: 'AtMyGym' } });
  });

  describe('asRow', () => {
    it('renders a ListRow instead of the pill, and reports its own visibility', async () => {
      mockUseMyCheckin.mockReturnValue({ data: CHECKED_IN, isLoading: false });
      mockUseNearbyCheckins.mockReturnValue({ data: [{ id: 'f1', display_name: 'Alex', distanceMeters: 10 }], isLoading: false });
      const onVisibilityChange = jest.fn();

      const { getByText } = await render(<GymProximityPill userId="user-1" asRow onVisibilityChange={onVisibilityChange} />);
      await waitFor(() => expect(getByText('1 friend checked in nearby')).toBeTruthy());
      expect(onVisibilityChange).toHaveBeenCalledWith(true);

      await fireEvent.press(getByText('1 friend checked in nearby'));
      expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'CommunityTab', params: { screen: 'AtMyGym' } });
    });

    it('reports itself as not visible when there is nothing to show', async () => {
      const onVisibilityChange = jest.fn();
      await render(<GymProximityPill userId="user-1" asRow onVisibilityChange={onVisibilityChange} />);
      await waitFor(() => expect(onVisibilityChange).toHaveBeenCalledWith(false));
    });
  });
});
