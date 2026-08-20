import React from 'react';
import { format, subDays } from 'date-fns';
import { render, waitFor } from '@testing-library/react-native';
import { RecoveryStoryLine } from '../RecoveryStoryLine';

const mockUseWhoopMetricsRange = jest.fn();

jest.mock('../../../services/api/queries/whoop', () => ({
  useWhoopMetricsRange: (...args: unknown[]) => mockUseWhoopMetricsRange(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUseWhoopMetricsRange.mockReturnValue({ data: [], isLoading: false });
});

function row(daysAgo: number, hrvMs: number | null, scoreState: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE' = 'SCORED') {
  return {
    id: `w-${daysAgo}`,
    user_id: 'user-1',
    cycle_date: format(subDays(new Date(), daysAgo), 'yyyy-MM-dd'),
    whoop_cycle_id: null,
    score_state: scoreState,
    recovery_score: 70,
    sleep_performance_pct: 80,
    strain: 10,
    hrv_ms: hrvMs,
    resting_heart_rate: 55,
    synced_at: new Date().toISOString(),
  };
}

describe('RecoveryStoryLine', () => {
  it('renders nothing with no history', async () => {
    const { toJSON } = await render(<RecoveryStoryLine userId="user-1" />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing without at least 6 scored days (5-day baseline + latest)', async () => {
    mockUseWhoopMetricsRange.mockReturnValue({ data: [row(4, 50), row(3, 50), row(2, 50), row(1, 60)], isLoading: false });
    const { toJSON } = await render(<RecoveryStoryLine userId="user-1" />);
    expect(toJSON()).toBeNull();
  });

  it('ignores unscored/pending days when counting the baseline', async () => {
    mockUseWhoopMetricsRange.mockReturnValue({
      data: [row(6, 50), row(5, 50), row(4, 50), row(3, 50), row(2, null, 'PENDING_SCORE'), row(1, 60)],
      isLoading: false,
    });
    const { toJSON } = await render(<RecoveryStoryLine userId="user-1" />);
    expect(toJSON()).toBeNull();
  });

  it('shows an "up" story when the latest HRV beats the baseline average', async () => {
    mockUseWhoopMetricsRange.mockReturnValue({
      data: [row(6, 50), row(5, 50), row(4, 50), row(3, 50), row(2, 50), row(1, 60)],
      isLoading: false,
    });
    const { getByText } = await render(<RecoveryStoryLine userId="user-1" />);
    await waitFor(() => expect(getByText(/HRV up 20% vs your 30-day baseline/)).toBeTruthy());
    expect(getByText(/adapting well/)).toBeTruthy();
  });

  it('shows a "down" story when the latest HRV trails the baseline average', async () => {
    mockUseWhoopMetricsRange.mockReturnValue({
      data: [row(6, 50), row(5, 50), row(4, 50), row(3, 50), row(2, 50), row(1, 40)],
      isLoading: false,
    });
    const { getByText } = await render(<RecoveryStoryLine userId="user-1" />);
    await waitFor(() => expect(getByText(/HRV down 20% vs your 30-day baseline/)).toBeTruthy());
    expect(getByText(/easier session/)).toBeTruthy();
  });

  it('renders nothing when the trend rounds to no change', async () => {
    mockUseWhoopMetricsRange.mockReturnValue({
      data: [row(6, 50), row(5, 50), row(4, 50), row(3, 50), row(2, 50), row(1, 50)],
      isLoading: false,
    });
    const { toJSON } = await render(<RecoveryStoryLine userId="user-1" />);
    expect(toJSON()).toBeNull();
  });

  describe('asRow', () => {
    it('renders a ListRow with the same story text, and reports its own visibility', async () => {
      mockUseWhoopMetricsRange.mockReturnValue({
        data: [row(6, 50), row(5, 50), row(4, 50), row(3, 50), row(2, 50), row(1, 60)],
        isLoading: false,
      });
      const onVisibilityChange = jest.fn();

      const { getByText } = await render(<RecoveryStoryLine userId="user-1" asRow onVisibilityChange={onVisibilityChange} />);
      await waitFor(() => expect(getByText(/HRV up 20% vs your 30-day baseline/)).toBeTruthy());
      expect(onVisibilityChange).toHaveBeenCalledWith(true);
    });

    it('reports itself as not visible when there is nothing to show', async () => {
      const onVisibilityChange = jest.fn();
      await render(<RecoveryStoryLine userId="user-1" asRow onVisibilityChange={onVisibilityChange} />);
      await waitFor(() => expect(onVisibilityChange).toHaveBeenCalledWith(false));
    });
  });
});
