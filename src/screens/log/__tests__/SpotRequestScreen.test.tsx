import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SpotRequestScreen } from '../SpotRequestScreen';

const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ goBack: mockGoBack }),
    useRoute: () => ({ params: { requestId: 'req-1' } }),
  };
});

jest.mock('../../../hooks/useUnitPreference', () => ({
  useUnitPreference: () => 'kg',
}));

const mockUseSpotRequest = jest.fn();
const mockRespondMutateAsync = jest.fn();

jest.mock('../../../services/api/queries/spotRequests', () => ({
  useSpotRequest: (...args: unknown[]) => mockUseSpotRequest(...args),
  useRespondToSpotRequest: () => ({ mutateAsync: mockRespondMutateAsync, isPending: false }),
}));

const PENDING_REQUEST = {
  id: 'req-1',
  requesterId: 'user-2',
  requesterDisplayName: 'Mike Torres',
  requesterAvatarUrl: null,
  requesterAvatarFocalX: 0.5,
  requesterAvatarFocalY: 0.5,
  exerciseName: 'Bench Press',
  setNumber: 3,
  loadKg: 84,
  status: 'pending' as const,
  responderId: null,
  createdAt: '2026-01-01T00:00:00Z',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  distanceMeters: 36.6,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseSpotRequest.mockReturnValue({ data: PENDING_REQUEST, isLoading: false });
});

describe('SpotRequestScreen', () => {
  it('shows the requester, exercise, and set/weight context for a pending request', async () => {
    const { getByText } = await render(<SpotRequestScreen />);
    expect(getByText('Mike Torres')).toBeTruthy();
    expect(getByText('Bench Press — Set 3')).toBeTruthy();
  });

  it('Accept calls respond_to_spot_request with accept:true and closes', async () => {
    mockRespondMutateAsync.mockResolvedValue(true);
    const { getByText } = await render(<SpotRequestScreen />);

    await fireEvent.press(getByText('Accept'));

    await waitFor(() => expect(mockRespondMutateAsync).toHaveBeenCalledWith({ requestId: 'req-1', accept: true }));
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('Decline calls respond_to_spot_request with accept:false and closes', async () => {
    mockRespondMutateAsync.mockResolvedValue(true);
    const { getByText } = await render(<SpotRequestScreen />);

    await fireEvent.press(getByText('Decline'));

    await waitFor(() => expect(mockRespondMutateAsync).toHaveBeenCalledWith({ requestId: 'req-1', accept: false }));
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('shows an unavailable state instead of Accept/Decline once the request has already resolved', async () => {
    mockUseSpotRequest.mockReturnValue({
      data: { ...PENDING_REQUEST, status: 'accepted' },
      isLoading: false,
    });
    const { getByText, queryByText } = await render(<SpotRequestScreen />);

    expect(getByText("This request isn't available")).toBeTruthy();
    expect(queryByText('Accept')).toBeNull();
  });

  it('shows an unavailable state when get_spot_request returns nothing (unauthorized, gone, or expired)', async () => {
    mockUseSpotRequest.mockReturnValue({ data: null, isLoading: false });
    const { getByText } = await render(<SpotRequestScreen />);

    expect(getByText("This request isn't available")).toBeTruthy();
  });
});
