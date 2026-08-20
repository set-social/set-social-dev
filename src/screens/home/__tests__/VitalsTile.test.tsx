import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { VitalsTile } from '../VitalsTile';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ navigate: mockNavigate }) };
});

jest.mock('../../../hooks/useUnitPreference', () => ({
  useUnitPreference: () => 'kg',
}));

const mockUseWeightTrend = jest.fn();
jest.mock('../useWeightTrend', () => ({
  useWeightTrend: (...args: unknown[]) => mockUseWeightTrend(...args),
}));

const mockUseFriendConsistencyPercentile = jest.fn();
jest.mock('../../../services/api/queries/community', () => ({
  useFriendConsistencyPercentile: (...args: unknown[]) => mockUseFriendConsistencyPercentile(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUseWeightTrend.mockReturnValue(null);
  mockUseFriendConsistencyPercentile.mockReturnValue({ data: null, isLoading: false });
});

describe('VitalsTile', () => {
  it('renders nothing when weight, consistency, and streak all have no data', async () => {
    const { toJSON } = await render(<VitalsTile userId="user-1" streak={0} />);
    expect(toJSON()).toBeNull();
  });

  it('renders only the segments that have data', async () => {
    mockUseWeightTrend.mockReturnValue(null);
    mockUseFriendConsistencyPercentile.mockReturnValue({ data: 82, isLoading: false });

    const { getByText, queryByText } = await render(<VitalsTile userId="user-1" streak={0} />);
    expect(getByText('CONSISTENCY')).toBeTruthy();
    expect(getByText('82%')).toBeTruthy();
    expect(queryByText('WEIGHT')).toBeNull();
    expect(queryByText('STREAK')).toBeNull();
  });

  it('shows weight, consistency, and streak together and navigates to Body Metrics on the weight tap', async () => {
    mockUseWeightTrend.mockReturnValue({ latestWeightKg: 82.5, deltaKg: -1.5, windowed: [] });
    mockUseFriendConsistencyPercentile.mockReturnValue({ data: 82, isLoading: false });

    const { getByText } = await render(<VitalsTile userId="user-1" streak={4} />);
    await waitFor(() => expect(getByText('82.5 kg')).toBeTruthy());
    expect(getByText(/-1.5 kg \/ 30d/)).toBeTruthy();
    expect(getByText('82%')).toBeTruthy();
    expect(getByText('4 days')).toBeTruthy();

    await fireEvent.press(getByText('82.5 kg'));
    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'ProgressTab', params: { screen: 'BodyMetrics' } });
  });

  it('singularizes a one-day streak', async () => {
    const { getByText } = await render(<VitalsTile userId="user-1" streak={1} />);
    expect(getByText('1 day')).toBeTruthy();
  });

  describe('asRow (rendered inside MoreForYouCard)', () => {
    it('reports itself visible once it has at least one segment', async () => {
      mockUseFriendConsistencyPercentile.mockReturnValue({ data: 82, isLoading: false });
      const onVisibilityChange = jest.fn();

      await render(<VitalsTile userId="user-1" streak={0} asRow onVisibilityChange={onVisibilityChange} />);

      await waitFor(() => expect(onVisibilityChange).toHaveBeenCalledWith(true));
    });

    it('reports itself not visible when there is nothing to show', async () => {
      const onVisibilityChange = jest.fn();

      await render(<VitalsTile userId="user-1" streak={0} asRow onVisibilityChange={onVisibilityChange} />);

      await waitFor(() => expect(onVisibilityChange).toHaveBeenCalledWith(false));
    });

    it('still renders the same segment content without its own Card wrapper', async () => {
      mockUseFriendConsistencyPercentile.mockReturnValue({ data: 82, isLoading: false });

      const { getByText } = await render(<VitalsTile userId="user-1" streak={4} asRow />);

      expect(getByText('82%')).toBeTruthy();
      expect(getByText('4 days')).toBeTruthy();
    });
  });
});
