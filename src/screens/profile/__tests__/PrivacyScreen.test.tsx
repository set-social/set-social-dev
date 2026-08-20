import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { PrivacyScreen } from '../PrivacyScreen';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ navigate: jest.fn(), canGoBack: () => false }) };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUseProfile = jest.fn();
const mockUpdateProfileMutate = jest.fn();

jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: (...args: unknown[]) => mockUseProfile(...args),
  useUpdateProfile: jest.fn(() => ({ mutate: mockUpdateProfileMutate })),
}));

const PROFILE = {
  id: 'user-1',
  is_private: true,
  hide_stats_from_friends: false,
  hide_photos_from_friends: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseProfile.mockReturnValue({ data: PROFILE, isLoading: false });
});

const props = { navigation: {} as never, route: { key: 'privacy', name: 'Privacy' as const, params: undefined } };

describe('PrivacyScreen', () => {
  it('shows the private-account explanation and lets the athlete turn it off', async () => {
    const { getByText, getByLabelText } = await render(<PrivacyScreen {...props} />);
    await waitFor(() => expect(getByText('Private account')).toBeTruthy());

    expect(getByText('People must send a friend request that you approve before you’re connected.')).toBeTruthy();

    await fireEvent(getByLabelText('Private account'), 'valueChange', false);
    expect(mockUpdateProfileMutate).toHaveBeenCalledWith({ is_private: false });
  });

  it('describes the instant-add behavior once the account is public', async () => {
    mockUseProfile.mockReturnValue({ data: { ...PROFILE, is_private: false }, isLoading: false });

    const { getByText } = await render(<PrivacyScreen {...props} />);
    await waitFor(() =>
      expect(getByText('Anyone can add you as a friend instantly — no request or approval needed.')).toBeTruthy(),
    );
  });

  it('defaults to private when the profile hasn’t loaded a value yet', async () => {
    mockUseProfile.mockReturnValue({ data: { ...PROFILE, is_private: undefined }, isLoading: false });

    const { getByText } = await render(<PrivacyScreen {...props} />);
    await waitFor(() =>
      expect(getByText('People must send a friend request that you approve before you’re connected.')).toBeTruthy(),
    );
  });

  it('lets the athlete hide their live workout status from friends', async () => {
    const { getByText, getByLabelText } = await render(<PrivacyScreen {...props} />);
    await waitFor(() => expect(getByText('Hide live workout status')).toBeTruthy());

    await fireEvent(getByLabelText('Hide live workout status'), 'valueChange', true);
    expect(mockUpdateProfileMutate).toHaveBeenCalledWith({ hide_live_workout_from_friends: true });
  });

  it('defaults Spot requests on and lets the athlete opt out — scoped to nearby athletes generally, not just friends', async () => {
    const { getByText, getByLabelText } = await render(<PrivacyScreen {...props} />);
    await waitFor(() => expect(getByText('Spot requests')).toBeTruthy());

    expect(getByLabelText('Spot requests').props.value).toBe(true);
    expect(getByText(/not just friends/)).toBeTruthy();

    await fireEvent(getByLabelText('Spot requests'), 'valueChange', false);
    expect(mockUpdateProfileMutate).toHaveBeenCalledWith({ push_spot_requests_enabled: false });
  });
});
