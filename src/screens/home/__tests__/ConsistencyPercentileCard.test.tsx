import React from 'react';
import { render } from '@testing-library/react-native';
import { ConsistencyPercentileCard } from '../ConsistencyPercentileCard';

const mockUseFriendConsistencyPercentile = jest.fn();

jest.mock('../../../services/api/queries/community', () => ({
  useFriendConsistencyPercentile: (...args: unknown[]) => mockUseFriendConsistencyPercentile(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ConsistencyPercentileCard', () => {
  it('renders nothing when there are no eligible friends yet', async () => {
    mockUseFriendConsistencyPercentile.mockReturnValue({ data: null, isLoading: false });
    const { toJSON } = await render(<ConsistencyPercentileCard userId="user-1" />);
    expect(toJSON()).toBeNull();
  });

  it('shows the percentile once one is available', async () => {
    mockUseFriendConsistencyPercentile.mockReturnValue({ data: 82, isLoading: false });
    const { getByText } = await render(<ConsistencyPercentileCard userId="user-1" />);
    expect(getByText('More consistent than 82% of your friends')).toBeTruthy();
  });

  it('treats a 0% result as a real value, not "no data"', async () => {
    mockUseFriendConsistencyPercentile.mockReturnValue({ data: 0, isLoading: false });
    const { getByText } = await render(<ConsistencyPercentileCard userId="user-1" />);
    expect(getByText('More consistent than 0% of your friends')).toBeTruthy();
  });
});
