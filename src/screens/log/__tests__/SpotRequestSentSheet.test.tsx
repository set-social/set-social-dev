import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SpotRequestSentSheet } from '../SpotRequestSentSheet';

jest.mock('../../../hooks/useUnitPreference', () => ({
  useUnitPreference: () => 'kg',
}));

const mockUseSpotRequest = jest.fn();
const mockCancelMutate = jest.fn();
const mockUseResponderProfile = jest.fn();

jest.mock('../../../services/api/queries/spotRequests', () => ({
  useSpotRequest: (...args: unknown[]) => mockUseSpotRequest(...args),
  useCancelSpotRequest: () => ({ mutate: mockCancelMutate, isPending: false }),
  useResponderProfile: (...args: unknown[]) => mockUseResponderProfile(...args),
}));

const PENDING_REQUEST = {
  id: 'req-1',
  status: 'pending' as const,
  responderId: null,
  expiresAt: new Date(Date.now() + 90_000).toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseSpotRequest.mockReturnValue({ data: PENDING_REQUEST, isLoading: false });
  mockUseResponderProfile.mockReturnValue({ data: null });
});

const baseProps = {
  visible: true,
  onClose: jest.fn(),
  requestId: 'req-1',
  exerciseName: 'Bench Press',
  setNumber: 3,
  loadKg: 84,
};

describe('SpotRequestSentSheet', () => {
  it('shows the exercise/set context and a live countdown while pending', async () => {
    const { getByText } = await render(<SpotRequestSentSheet {...baseProps} />);
    expect(getByText('Spot request sent')).toBeTruthy();
    expect(getByText('Bench Press')).toBeTruthy();
    expect(getByText(/Expires in/)).toBeTruthy();
  });

  it('OK dismisses without canceling the request', async () => {
    const onClose = jest.fn();
    const { getByText } = await render(<SpotRequestSentSheet {...baseProps} onClose={onClose} />);

    await fireEvent.press(getByText('OK'));

    expect(onClose).toHaveBeenCalled();
    expect(mockCancelMutate).not.toHaveBeenCalled();
  });

  it('Cancel Request cancels the request and closes the sheet', async () => {
    const onClose = jest.fn();
    const { getByText } = await render(<SpotRequestSentSheet {...baseProps} onClose={onClose} />);

    await fireEvent.press(getByText('Cancel Request'));

    expect(mockCancelMutate).toHaveBeenCalledWith('req-1');
    expect(onClose).toHaveBeenCalled();
  });

  it('flips to the confirmed state with the responder\'s name once accepted, no separate navigation', async () => {
    mockUseSpotRequest.mockReturnValue({
      data: { ...PENDING_REQUEST, status: 'accepted', responderId: 'user-3' },
      isLoading: false,
    });
    mockUseResponderProfile.mockReturnValue({
      data: { id: 'user-3', display_name: 'Sarah Kim', avatar_url: null, avatar_focal_x: 0.5, avatar_focal_y: 0.5 },
    });

    const { getByText, queryByText } = await render(<SpotRequestSentSheet {...baseProps} />);

    await waitFor(() => expect(getByText('Sarah Kim')).toBeTruthy());
    expect(getByText(/is on the way to spot your/)).toBeTruthy();
    expect(queryByText('Cancel Request')).toBeNull();
  });

  it('passes the responder lookup only once accepted, not while still pending', async () => {
    await render(<SpotRequestSentSheet {...baseProps} />);
    expect(mockUseResponderProfile).toHaveBeenCalledWith(null);
  });
});
