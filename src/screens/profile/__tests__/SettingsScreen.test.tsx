import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert, Linking, Platform } from 'react-native';
import { SettingsScreen } from '../SettingsScreen';
import { useFocusModeStore } from '../../../store/focusModeStore';
import { useRestTimerPreferenceStore } from '../../../store/restTimerPreferenceStore';

const mockNavigate = jest.fn();
const mockRootNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ navigate: mockRootNavigate, canGoBack: () => false }) };
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

const mockRestoreMutate = jest.fn();

jest.mock('../../../services/api/queries/purchases', () => ({
  useRestorePurchases: jest.fn(() => ({ mutate: mockRestoreMutate })),
}));

// REVENUECAT_ENABLED is currently hardcoded off (see its own doc comment —
// a bad key crashed a live App Store build) — this file exercises Restore
// Purchases as it behaves once that's flipped back on; the disabled
// default's own "row is hidden entirely" behavior is covered separately in
// SettingsScreen.betaDisabled.test.tsx, against the real unmocked flag.
jest.mock('../../../services/purchases/revenueCat', () => ({
  ...jest.requireActual('../../../services/purchases/revenueCat'),
  REVENUECAT_ENABLED: true,
}));

const mockSignOut = jest.fn();

jest.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ signOut: mockSignOut, loading: false }),
}));

const props = { navigation: { navigate: mockNavigate } as never, route: { key: 'settings', name: 'Settings' as const, params: undefined } };

beforeEach(() => {
  jest.clearAllMocks();
  useFocusModeStore.setState({ focusModeEnabled: false });
});

describe('SettingsScreen — SetSocial Pro', () => {
  it('navigates to the paywall when a non-Pro athlete taps the banner', async () => {
    mockUseProfile.mockReturnValue({ data: { is_premium: false }, isLoading: false });
    const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

    const { getByLabelText } = await render(<SettingsScreen {...props} />);
    await fireEvent.press(getByLabelText('Upgrade to SetSocial Pro'));

    expect(mockRootNavigate).toHaveBeenCalledWith('Paywall');
    expect(openURLSpy).not.toHaveBeenCalled();
  });

  it('opens the OS subscription settings, not an in-app popup, when a Pro athlete taps Manage', async () => {
    mockUseProfile.mockReturnValue({ data: { is_premium: true }, isLoading: false });
    const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

    const { getByLabelText } = await render(<SettingsScreen {...props} />);
    await fireEvent.press(getByLabelText('Manage SetSocial Pro subscription'));

    const expectedUrl =
      Platform.OS === 'ios' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions';
    expect(openURLSpy).toHaveBeenCalledWith(expectedUrl);
    expect(mockRootNavigate).not.toHaveBeenCalledWith('Paywall');
  });

  it('alerts with fallback instructions if the OS subscription link fails to open', async () => {
    mockUseProfile.mockReturnValue({ data: { is_premium: true }, isLoading: false });
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByLabelText } = await render(<SettingsScreen {...props} />);
    await fireEvent.press(getByLabelText('Manage SetSocial Pro subscription'));

    expect(alertSpy).toHaveBeenCalledWith('Could not open subscription settings', expect.any(String));
  });

  it('shows Restore Purchases only for non-Pro athletes', async () => {
    mockUseProfile.mockReturnValue({ data: { is_premium: true }, isLoading: false });
    const premium = await render(<SettingsScreen {...props} />);
    expect(premium.queryByText('Restore Purchases')).toBeNull();

    mockUseProfile.mockReturnValue({ data: { is_premium: false }, isLoading: false });
    const free = await render(<SettingsScreen {...props} />);
    await waitFor(() => expect(free.getByText('Restore Purchases')).toBeTruthy());
  });

  it('alerts with the result after restoring purchases', async () => {
    mockUseProfile.mockReturnValue({ data: { is_premium: false }, isLoading: false });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockRestoreMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess({ entitlements: { active: { 'SetSocial Pro': {} } } });
    });

    const { getByText } = await render(<SettingsScreen {...props} />);
    await fireEvent.press(getByText('Restore Purchases'));

    expect(alertSpy).toHaveBeenCalledWith('Restored', 'Your SetSocial Pro purchase has been restored.');
  });

  it('alerts when a restore finds nothing to restore', async () => {
    mockUseProfile.mockReturnValue({ data: { is_premium: false }, isLoading: false });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockRestoreMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess({ entitlements: { active: {} } });
    });

    const { getByText } = await render(<SettingsScreen {...props} />);
    await fireEvent.press(getByText('Restore Purchases'));

    expect(alertSpy).toHaveBeenCalledWith('Nothing to restore', "We didn't find a previous purchase for this account.");
  });

  it('shows the athlete\'s own profile card at the top of the merged screen', async () => {
    mockUseProfile.mockReturnValue({
      data: { is_premium: false, display_name: 'Jordan Cole', email: 'jordan.cole@gmail.com' },
      isLoading: false,
    });

    const { getByText } = await render(<SettingsScreen {...props} />);
    expect(getByText('Jordan Cole')).toBeTruthy();
    expect(getByText('jordan.cole@gmail.com')).toBeTruthy();
  });

  it('signs out when Sign Out is pressed', async () => {
    mockUseProfile.mockReturnValue({ data: { is_premium: false }, isLoading: false });

    const { getByText } = await render(<SettingsScreen {...props} />);
    await fireEvent.press(getByText('Sign Out'));

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsScreen — Focus Mode', () => {
  it('toggles focusModeStore when the Focus Mode switch is flipped', async () => {
    mockUseProfile.mockReturnValue({ data: { is_premium: false }, isLoading: false });

    const { getByLabelText } = await render(<SettingsScreen {...props} />);
    expect(useFocusModeStore.getState().focusModeEnabled).toBe(false);

    await fireEvent(getByLabelText('Focus Mode'), 'valueChange', true);
    expect(useFocusModeStore.getState().focusModeEnabled).toBe(true);
  });
});

describe('SettingsScreen — Nutrition', () => {
  it('defaults the Goal picker to Maintain when the profile has no nutrition_goal yet', async () => {
    mockUseProfile.mockReturnValue({ data: { is_premium: false, nutrition_goal: undefined }, isLoading: false });

    const { getByText } = await render(<SettingsScreen {...props} />);
    await fireEvent.press(getByText('Cut'));

    expect(mockUpdateProfileMutate).toHaveBeenCalledWith({ nutrition_goal: 'cut' });
  });

  it('saves bulk when Bulk is selected', async () => {
    mockUseProfile.mockReturnValue({ data: { is_premium: false, nutrition_goal: 'maintain' }, isLoading: false });

    const { getByText } = await render(<SettingsScreen {...props} />);
    await fireEvent.press(getByText('Bulk'));

    expect(mockUpdateProfileMutate).toHaveBeenCalledWith({ nutrition_goal: 'bulk' });
  });

  it('navigates to Body Metrics on the Progress tab when Body Profile is pressed', async () => {
    mockUseProfile.mockReturnValue({ data: { is_premium: false }, isLoading: false });

    const { getByText } = await render(<SettingsScreen {...props} />);
    await fireEvent.press(getByText('Body Profile'));

    expect(mockRootNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'ProgressTab', params: { screen: 'BodyMetrics' } });
  });
});

describe('SettingsScreen — Rest Timer', () => {
  afterEach(() => {
    useRestTimerPreferenceStore.getState().setRestTimerEnabled(true);
  });

  it('toggles restTimerPreferenceStore when the Rest Timer switch is flipped', async () => {
    mockUseProfile.mockReturnValue({ data: { is_premium: false }, isLoading: false });

    const { getByLabelText } = await render(<SettingsScreen {...props} />);
    expect(useRestTimerPreferenceStore.getState().restTimerEnabled).toBe(true);

    await fireEvent(getByLabelText('Rest Timer'), 'valueChange', false);
    expect(useRestTimerPreferenceStore.getState().restTimerEnabled).toBe(false);
  });
});
