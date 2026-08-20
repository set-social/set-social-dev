import React from 'react';
import { render } from '@testing-library/react-native';
import { PaywallScreen } from '../PaywallScreen';

// Deliberately does NOT mock '../../../services/purchases/revenueCat' — this
// exercises the real REVENUECAT_ENABLED = false default (see its doc
// comment: a bad test key crashed a live App Store build, so purchasing is
// hard-disabled until real keys are wired up and a fresh build ships).

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock('../../../services/api/queries/purchases', () => ({
  useOfferings: () => ({ data: { current: null }, isLoading: false, refetch: jest.fn() }),
  usePurchasePackage: () => ({ mutate: jest.fn(), isPending: false }),
  useRestorePurchases: () => ({ mutate: jest.fn(), isPending: false }),
  // 'already used' — this file's only test asserts the beta-unavailable
  // message, not trial behavior (see PaywallScreen.test.tsx's own "free
  // trial" describe block for that), so the trial CTA stays out of the way.
  useHasUsedTrial: () => ({ data: true }),
  useStartFreeTrial: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: () => ({ data: { is_premium: false } }),
}));

function renderScreen() {
  const navigation = { goBack: jest.fn() } as never;
  const route = { key: 'paywall', name: 'Paywall' as const, params: undefined } as never;
  return render(<PaywallScreen navigation={navigation} route={route} />);
}

describe('PaywallScreen — REVENUECAT_ENABLED off (current default)', () => {
  it('shows a beta-unavailable message instead of plans or purchase buttons', async () => {
    const { getByText, queryByText } = await renderScreen();

    expect(getByText('Not available yet')).toBeTruthy();
    expect(queryByText('Continue')).toBeNull();
    expect(queryByText('Restore Purchases')).toBeNull();
    expect(queryByText('Pricing unavailable')).toBeNull();
  });
});
