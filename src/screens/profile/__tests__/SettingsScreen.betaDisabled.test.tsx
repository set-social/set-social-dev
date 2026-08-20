import React from 'react';
import { render } from '@testing-library/react-native';
import { SettingsScreen } from '../SettingsScreen';

// Deliberately does NOT mock '../../../services/purchases/revenueCat' — this
// exercises the real REVENUECAT_ENABLED = false default (see its doc
// comment: a bad test key crashed a live App Store build, so purchasing/
// restoring is hard-disabled until real keys are wired up and a fresh build
// ships).

const mockRootNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ navigate: mockRootNavigate, canGoBack: () => false }) };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUseProfile = jest.fn();

jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: (...args: unknown[]) => mockUseProfile(...args),
  useUpdateProfile: jest.fn(() => ({ mutate: jest.fn() })),
}));

jest.mock('../../../services/api/queries/purchases', () => ({
  useRestorePurchases: jest.fn(() => ({ mutate: jest.fn() })),
}));

jest.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ signOut: jest.fn(), loading: false }),
}));

const props = { navigation: { navigate: jest.fn() } as never, route: { key: 'settings', name: 'Settings' as const, params: undefined } };

describe('SettingsScreen — REVENUECAT_ENABLED off (current default)', () => {
  it('never shows Restore Purchases, Pro or not', async () => {
    mockUseProfile.mockReturnValue({ data: { is_premium: true }, isLoading: false });
    const pro = await render(<SettingsScreen {...props} />);
    expect(pro.queryByText('Restore Purchases')).toBeNull();

    mockUseProfile.mockReturnValue({ data: { is_premium: false }, isLoading: false });
    const free = await render(<SettingsScreen {...props} />);
    expect(free.queryByText('Restore Purchases')).toBeNull();
  });
});
