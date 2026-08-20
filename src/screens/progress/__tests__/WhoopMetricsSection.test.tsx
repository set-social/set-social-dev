import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { WhoopMetricsSection } from '../WhoopMetricsSection';

jest.mock('../../../hooks/useUnitPreference', () => ({
  useUnitPreference: () => 'kg',
}));

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useEffect } = require('react');
  return {
    ...actual,
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  };
});

const mockUseIntegrationConnections = jest.fn();
jest.mock('../../../services/api/queries/integrations', () => ({
  useIntegrationConnections: (...args: unknown[]) => mockUseIntegrationConnections(...args),
}));

const mockUseWhoopMetrics = jest.fn();
const mockSyncMutate = jest.fn();
jest.mock('../../../services/api/queries/whoop', () => ({
  useWhoopMetrics: (...args: unknown[]) => mockUseWhoopMetrics(...args),
  useSyncWhoopMetrics: () => ({ mutate: mockSyncMutate }),
}));

const TODAY = '2026-01-14';

function whoopRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    cycle_date: TODAY,
    score_state: 'SCORED',
    recovery_score: 82,
    sleep_performance_pct: 72,
    strain: 12.8,
    hrv_ms: 48,
    resting_heart_rate: 58,
    sleep_efficiency_pct: 91,
    sleep_consistency_pct: 76,
    respiratory_rate: 15.8,
    rem_sleep_minutes: 88,
    deep_sleep_minutes: 69,
    light_sleep_minutes: 207,
    awake_minutes: 19,
    sleep_debt_minutes: 42,
    spo2_pct: 97.2,
    skin_temp_celsius: 31.8,
    synced_at: '',
    ...overrides,
  };
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
  mockUseIntegrationConnections.mockReturnValue({
    data: [{ provider: 'whoop', access_token: 'token' }],
    isLoading: false,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('WhoopMetricsSection', () => {
  it('shows HRV and resting heart rate under the rings when both are present', async () => {
    mockUseWhoopMetrics.mockReturnValue({ data: whoopRow(), isLoading: false });

    const { getByText } = await render(<WhoopMetricsSection userId="user-1" />);

    await waitFor(() => expect(getByText('82%')).toBeTruthy());
    expect(getByText('HRV')).toBeTruthy();
    expect(getByText('48 ms')).toBeTruthy();
    expect(getByText('RESTING HR')).toBeTruthy();
    expect(getByText('58 bpm')).toBeTruthy();
  });

  it('shows an em dash for whichever biostat is missing, without hiding the other', async () => {
    mockUseWhoopMetrics.mockReturnValue({
      data: whoopRow({ resting_heart_rate: null }),
      isLoading: false,
    });

    const { getByText } = await render(<WhoopMetricsSection userId="user-1" />);

    await waitFor(() => expect(getByText('48 ms')).toBeTruthy());
    expect(getByText('RESTING HR')).toBeTruthy();
    expect(getByText('—')).toBeTruthy();
  });

  it('omits the biostat row entirely when neither HRV nor resting heart rate is present', async () => {
    mockUseWhoopMetrics.mockReturnValue({
      data: whoopRow({ hrv_ms: null, resting_heart_rate: null }),
      isLoading: false,
    });

    const { getByText, queryByText } = await render(<WhoopMetricsSection userId="user-1" />);

    await waitFor(() => expect(getByText('82%')).toBeTruthy());
    expect(queryByText('HRV')).toBeNull();
    expect(queryByText('RESTING HR')).toBeNull();
  });

  it('keeps the sleep detail panel collapsed by default, and reveals it on tap', async () => {
    mockUseWhoopMetrics.mockReturnValue({ data: whoopRow(), isLoading: false });

    const { getByText, queryByText } = await render(<WhoopMetricsSection userId="user-1" />);

    await waitFor(() => expect(getByText('More details')).toBeTruthy());
    expect(queryByText('Efficiency')).toBeNull();
    expect(queryByText('SpO2')).toBeNull();

    await fireEvent.press(getByText('More details'));

    // Regression guard for the reported bug: "Consistency" was wrapping
    // ("...cy" orphaned onto its own line) under the old 3-per-row layout —
    // it now renders as one unbroken StatTileBody label, same as every
    // other metric in this row (StatTileBody upper-cases its own label).
    expect(getByText('CONSISTENCY')).toBeTruthy();
    expect(getByText('91%')).toBeTruthy(); // efficiency
    expect(getByText('76%')).toBeTruthy(); // consistency
    expect(getByText('15.8/min')).toBeTruthy(); // respiratory rate
    expect(getByText('97.2%')).toBeTruthy(); // SpO2
    expect(getByText('31.8°C')).toBeTruthy(); // skin temp, metric unit pref
    expect(getByText('42m')).toBeTruthy(); // sleep debt
    expect(getByText('REM 1h 28m', { exact: false })).toBeTruthy();
    expect(getByText('Deep 1h 9m', { exact: false })).toBeTruthy();

    // Tapping again collapses it.
    await fireEvent.press(getByText('More details'));
    expect(queryByText('Efficiency')).toBeNull();
  });

  it('omits the More details row entirely when none of the new fields have synced yet', async () => {
    mockUseWhoopMetrics.mockReturnValue({
      data: whoopRow({
        sleep_efficiency_pct: null,
        sleep_consistency_pct: null,
        respiratory_rate: null,
        rem_sleep_minutes: null,
        deep_sleep_minutes: null,
        light_sleep_minutes: null,
        awake_minutes: null,
        sleep_debt_minutes: null,
        spo2_pct: null,
        skin_temp_celsius: null,
      }),
      isLoading: false,
    });

    const { getByText, queryByText } = await render(<WhoopMetricsSection userId="user-1" />);

    await waitFor(() => expect(getByText('82%')).toBeTruthy());
    expect(queryByText('More details')).toBeNull();
  });

  it('still shows the not-connected state untouched', async () => {
    mockUseIntegrationConnections.mockReturnValue({ data: [], isLoading: false });
    mockUseWhoopMetrics.mockReturnValue({ data: undefined, isLoading: false });

    const { getByText } = await render(<WhoopMetricsSection userId="user-1" />);

    await waitFor(() =>
      expect(
        getByText('Not connected — connect Whoop in Integrations to see your recovery, sleep, and strain here.'),
      ).toBeTruthy(),
    );
  });
});
