import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { AtMyGymScreen } from '../AtMyGymScreen';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ navigate: mockNavigate, canGoBack: () => true }) };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUseMyCheckin = jest.fn();
const mockUseNearbyCheckins = jest.fn();
const mockCheckInMutateAsync = jest.fn();
const mockCheckOutMutate = jest.fn();

jest.mock('../../../services/api/queries/location', () => ({
  useMyCheckin: (...args: unknown[]) => mockUseMyCheckin(...args),
  useCheckIn: jest.fn(() => ({ mutateAsync: mockCheckInMutateAsync, isPending: false })),
  useCheckOut: jest.fn(() => ({ mutate: mockCheckOutMutate, isPending: false })),
  useNearbyCheckins: (...args: unknown[]) => mockUseNearbyCheckins(...args),
}));

const mockGetCurrentLocation = jest.fn();

jest.mock('../../../services/location/currentLocation', () => {
  const actual = jest.requireActual('../../../services/location/currentLocation');
  return {
    ...actual,
    getCurrentLocation: (...args: unknown[]) => mockGetCurrentLocation(...args),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUseMyCheckin.mockReturnValue({ data: null, isLoading: false });
  mockUseNearbyCheckins.mockReturnValue({ data: [], isLoading: false });
});

describe('AtMyGymScreen', () => {
  it('prompts to check in, reads location, and checks in', async () => {
    mockGetCurrentLocation.mockResolvedValue({ latitude: 40.0, longitude: -73.0 });
    mockCheckInMutateAsync.mockResolvedValue(undefined);

    const { getByText } = await render(<AtMyGymScreen />);
    await waitFor(() => expect(getByText('Check In')).toBeTruthy());

    await fireEvent.press(getByText('Check In'));

    expect(mockGetCurrentLocation).toHaveBeenCalled();
    await waitFor(() =>
      expect(mockCheckInMutateAsync).toHaveBeenCalledWith({ latitude: 40.0, longitude: -73.0 }),
    );
  });

  it('shows a "could not check in" alert when location fails, without checking in', async () => {
    const { LocationUnavailableError } = jest.requireActual('../../../services/location/currentLocation');
    mockGetCurrentLocation.mockRejectedValue(new LocationUnavailableError('Location permission was not granted.'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByText } = await render(<AtMyGymScreen />);
    await waitFor(() => expect(getByText('Check In')).toBeTruthy());
    await fireEvent.press(getByText('Check In'));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Could not check in', 'Location permission was not granted.'),
    );
    expect(mockCheckInMutateAsync).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('shows the expiry time and nearby athletes once checked in, and navigates to a profile on tap', async () => {
    mockUseMyCheckin.mockReturnValue({
      data: { checkedInAt: '2026-01-01T10:00:00.000Z', expiresAt: '2026-01-01T14:00:00.000Z' },
      isLoading: false,
    });
    mockUseNearbyCheckins.mockReturnValue({
      data: [
        { id: 'user-2', display_name: 'Sam K.', avatar_url: null, distanceMeters: 42 },
        { id: 'user-3', display_name: 'Jo P.', avatar_url: null, distanceMeters: 2000 },
      ],
      isLoading: false,
    });

    const { getByText } = await render(<AtMyGymScreen />);
    await waitFor(() => expect(getByText("You're checked in")).toBeTruthy());

    expect(getByText('Sam K.')).toBeTruthy();
    expect(getByText('138ft away')).toBeTruthy();
    expect(getByText('Jo P.')).toBeTruthy();
    expect(getByText('1.2mi away')).toBeTruthy();

    await fireEvent.press(getByText('Sam K.'));
    expect(mockNavigate).toHaveBeenCalledWith('FriendProfile', { userId: 'user-2' });
  });

  it('shows an empty state when checked in but no one else is nearby', async () => {
    mockUseMyCheckin.mockReturnValue({
      data: { checkedInAt: '2026-01-01T10:00:00.000Z', expiresAt: '2026-01-01T14:00:00.000Z' },
      isLoading: false,
    });
    mockUseNearbyCheckins.mockReturnValue({ data: [], isLoading: false });

    const { getByText } = await render(<AtMyGymScreen />);
    await waitFor(() => expect(getByText('No one else checked in nearby')).toBeTruthy());
  });

  it('checks out after confirming', async () => {
    mockUseMyCheckin.mockReturnValue({
      data: { checkedInAt: '2026-01-01T10:00:00.000Z', expiresAt: '2026-01-01T14:00:00.000Z' },
      isLoading: false,
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const confirm = buttons?.find(b => b.text === 'Check Out');
      confirm?.onPress?.();
    });

    const { getByText } = await render(<AtMyGymScreen />);
    await waitFor(() => expect(getByText('Check Out')).toBeTruthy());
    await fireEvent.press(getByText('Check Out'));

    expect(mockCheckOutMutate).toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
