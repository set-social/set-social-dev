import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { WeightTrendCard } from '../WeightTrendCard';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ navigate: mockNavigate }) };
});

jest.mock('../../../hooks/useUnitPreference', () => ({
  useUnitPreference: () => 'kg',
}));

const mockUseBodyMetrics = jest.fn();

jest.mock('../../../services/api/queries/bodyMetrics', () => ({
  useBodyMetrics: (...args: unknown[]) => mockUseBodyMetrics(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUseBodyMetrics.mockReturnValue({ data: [], isLoading: false });
});

const entry = (daysAgo: number, weightKg: number) => ({
  id: `m-${daysAgo}`,
  user_id: 'user-1',
  logged_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  weight_kg: weightKg,
  notes: null,
});

describe('WeightTrendCard', () => {
  it('renders nothing with no history', async () => {
    const { toJSON } = await render(<WeightTrendCard userId="user-1" />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing with only one entry in the last 30 days', async () => {
    mockUseBodyMetrics.mockReturnValue({ data: [entry(2, 82)], isLoading: false });
    const { toJSON } = await render(<WeightTrendCard userId="user-1" />);
    expect(toJSON()).toBeNull();
  });

  it('ignores entries older than the 30-day window when deciding whether to render', async () => {
    mockUseBodyMetrics.mockReturnValue({ data: [entry(90, 90), entry(2, 82)], isLoading: false });
    const { toJSON } = await render(<WeightTrendCard userId="user-1" />);
    expect(toJSON()).toBeNull();
  });

  it('shows the latest weight and a downward trend, and navigates to Body Metrics on tap', async () => {
    mockUseBodyMetrics.mockReturnValue({ data: [entry(20, 84), entry(1, 82.5)], isLoading: false });

    const { getByText } = await render(<WeightTrendCard userId="user-1" />);
    await waitFor(() => expect(getByText('82.5 kg')).toBeTruthy());
    expect(getByText(/-1.5 kg \/ 30d/)).toBeTruthy();

    await fireEvent.press(getByText('82.5 kg'));
    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'ProgressTab', params: { screen: 'BodyMetrics' } });
  });

  it('shows an upward trend with a + sign', async () => {
    mockUseBodyMetrics.mockReturnValue({ data: [entry(20, 80), entry(1, 82)], isLoading: false });

    const { getByText } = await render(<WeightTrendCard userId="user-1" />);
    await waitFor(() => expect(getByText(/\+2 kg \/ 30d/)).toBeTruthy());
  });

  it('shows "No change" when the delta rounds to zero', async () => {
    mockUseBodyMetrics.mockReturnValue({ data: [entry(20, 82), entry(1, 82)], isLoading: false });

    const { getByText } = await render(<WeightTrendCard userId="user-1" />);
    await waitFor(() => expect(getByText('No change')).toBeTruthy());
  });
});
