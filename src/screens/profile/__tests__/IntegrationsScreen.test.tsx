import React from 'react';
import { Alert, Linking } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { IntegrationsScreen } from '../IntegrationsScreen';

const mockSetParams = jest.fn();
const mockNavigate = jest.fn();
const mockInvalidateQueries = jest.fn();
let mockRouteParams: { status?: 'success' | 'error'; message?: string } | undefined;

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useEffect } = require('react');
  return {
    ...actual,
    useNavigation: () => ({ canGoBack: () => true, setParams: mockSetParams, navigate: mockNavigate }),
    useRoute: () => ({ params: mockRouteParams }),
    // The real hook needs a live NavigationContainer to know about focus
    // events — for these tests, running the callback once like a plain
    // effect is enough to cover the refetch-on-focus behavior.
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  };
});

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUseProfile = jest.fn();
jest.mock('../../../services/api/queries/profiles', () => ({
  useProfile: (...args: unknown[]) => mockUseProfile(...args),
}));

const mockUseIntegrationConnections = jest.fn();
const mockRefetch = jest.fn();
const mockStartConnectMutateAsync = jest.fn();
const mockStartSpotifyConnectMutateAsync = jest.fn();
const mockStartOuraConnectMutateAsync = jest.fn();
const mockDisconnectMutate = jest.fn();

jest.mock('../../../services/api/queries/integrations', () => ({
  useIntegrationConnections: (...args: unknown[]) => mockUseIntegrationConnections(...args),
  useStartWhoopConnect: jest.fn(() => ({ mutateAsync: mockStartConnectMutateAsync, isPending: false })),
  useStartSpotifyConnect: jest.fn(() => ({ mutateAsync: mockStartSpotifyConnectMutateAsync, isPending: false })),
  useStartOuraConnect: jest.fn(() => ({ mutateAsync: mockStartOuraConnectMutateAsync, isPending: false })),
  useDisconnectIntegration: jest.fn(() => ({ mutate: mockDisconnectMutate, isPending: false })),
}));

const mockUseDeviceHealthConnection = jest.fn();
const mockUseLatestAppleHealthMetrics = jest.fn();
const mockSyncMutate = jest.fn();
const mockDisconnectAppleHealthMutate = jest.fn();

jest.mock('../../../services/api/queries/appleHealth', () => ({
  isAppleHealthAvailable: jest.fn(() => true),
  useDeviceHealthConnection: (...args: unknown[]) => mockUseDeviceHealthConnection(...args),
  useLatestAppleHealthMetrics: (...args: unknown[]) => mockUseLatestAppleHealthMetrics(...args),
  useSyncAppleHealth: jest.fn(() => ({ mutate: mockSyncMutate, isPending: false })),
  useDisconnectAppleHealth: jest.fn(() => ({ mutate: mockDisconnectAppleHealthMutate, isPending: false })),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = undefined;
  mockUseIntegrationConnections.mockReturnValue({ data: [], isLoading: false, refetch: mockRefetch });
  mockUseDeviceHealthConnection.mockReturnValue({ data: null, isLoading: false });
  mockUseLatestAppleHealthMetrics.mockReturnValue({ data: null });
  // Pro by default — most of these tests exercise the OAuth mechanics,
  // not the Pro gate, which gets its own tests below.
  mockUseProfile.mockReturnValue({ data: { is_premium: true }, isLoading: false });
  jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
});

describe('IntegrationsScreen', () => {
  it('shows Whoop as not connected when there is no stored connection', async () => {
    const { getByText, getAllByText } = await render(<IntegrationsScreen />);
    await waitFor(() => expect(getByText('Whoop')).toBeTruthy());
    // Spotify, Oura, and Apple Health are also unconnected in this default
    // mock, so all four cards show the pill — asserting there are four
    // rather than picking one apart.
    expect(getAllByText('Not connected')).toHaveLength(4);
  });

  it('lists Spotify alongside Whoop and starts its own OAuth flow independently', async () => {
    mockStartSpotifyConnectMutateAsync.mockResolvedValue({
      url: 'https://accounts.spotify.com/authorize?state=abc',
    });

    const { getByText } = await render(<IntegrationsScreen />);
    await waitFor(() => expect(getByText('Spotify')).toBeTruthy());
    await fireEvent.press(getByText('Spotify'));
    await fireEvent.press(getByText('Connect Spotify'));

    await waitFor(() => expect(mockStartSpotifyConnectMutateAsync).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(Linking.openURL).toHaveBeenCalledWith('https://accounts.spotify.com/authorize?state=abc'),
    );
    // Whoop's own connect mutation is untouched by a Spotify-card tap.
    expect(mockStartConnectMutateAsync).not.toHaveBeenCalled();
  });

  it('does not render any client id/secret input fields', async () => {
    const { getByText, queryByPlaceholderText } = await render(<IntegrationsScreen />);
    await waitFor(() => expect(getByText('Whoop')).toBeTruthy());
    await fireEvent.press(getByText('Whoop'));

    expect(queryByPlaceholderText('Client ID')).toBeNull();
    expect(queryByPlaceholderText('Client Secret')).toBeNull();
  });

  it('starts the OAuth flow and opens the returned WHOOP authorize URL when Connect is pressed', async () => {
    mockStartConnectMutateAsync.mockResolvedValue({ url: 'https://api.prod.whoop.com/oauth/oauth2/auth?state=abc' });

    const { getByText } = await render(<IntegrationsScreen />);
    await waitFor(() => expect(getByText('Whoop')).toBeTruthy());
    await fireEvent.press(getByText('Whoop'));
    await fireEvent.press(getByText('Connect Whoop'));

    await waitFor(() => expect(mockStartConnectMutateAsync).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(Linking.openURL).toHaveBeenCalledWith('https://api.prod.whoop.com/oauth/oauth2/auth?state=abc'),
    );
  });

  it('shows an alert if starting the OAuth flow fails', async () => {
    mockStartConnectMutateAsync.mockRejectedValue(new Error('Missing Authorization header'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByText } = await render(<IntegrationsScreen />);
    await waitFor(() => expect(getByText('Whoop')).toBeTruthy());
    await fireEvent.press(getByText('Whoop'));
    await fireEvent.press(getByText('Connect Whoop'));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Could not start connection', 'Missing Authorization header'),
    );
    expect(Linking.openURL).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('lets a free (non-Pro) user connect Whoop — no integration is gated', async () => {
    mockUseProfile.mockReturnValue({ data: { is_premium: false }, isLoading: false });
    mockStartConnectMutateAsync.mockResolvedValue({ url: 'https://api.prod.whoop.com/oauth/oauth2/auth?state=abc' });

    const { getByText } = await render(<IntegrationsScreen />);
    await waitFor(() => expect(getByText('Whoop')).toBeTruthy());
    await fireEvent.press(getByText('Whoop'));
    await fireEvent.press(getByText('Connect Whoop'));

    await waitFor(() => expect(mockStartConnectMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('lets a free user connect Spotify too', async () => {
    mockUseProfile.mockReturnValue({ data: { is_premium: false }, isLoading: false });
    mockStartSpotifyConnectMutateAsync.mockResolvedValue({
      url: 'https://accounts.spotify.com/authorize?state=abc',
    });

    const { getByText } = await render(<IntegrationsScreen />);
    await waitFor(() => expect(getByText('Spotify')).toBeTruthy());
    await fireEvent.press(getByText('Spotify'));
    await fireEvent.press(getByText('Connect Spotify'));

    await waitFor(() => expect(mockStartSpotifyConnectMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('groups Whoop, Oura, and Apple Health under Wearables, and Spotify under Convenience, with a Beta pip on Oura and Apple Health only', async () => {
    const { getByText, getAllByText } = await render(<IntegrationsScreen />);
    await waitFor(() => expect(getByText('Oura')).toBeTruthy());

    expect(getByText('WEARABLES')).toBeTruthy();
    expect(getByText('CONVENIENCE')).toBeTruthy();
    expect(getByText('Apple Health')).toBeTruthy();
    // Oura and Apple Health are in beta — Whoop and Spotify aren't.
    expect(getAllByText('BETA')).toHaveLength(2);
  });

  it('lists Oura alongside Whoop and Spotify, starts its own OAuth flow, and is free for everyone', async () => {
    mockUseProfile.mockReturnValue({ data: { is_premium: false }, isLoading: false });
    mockStartOuraConnectMutateAsync.mockResolvedValue({
      url: 'https://cloud.ouraring.com/oauth/authorize?state=abc',
    });

    const { getByText } = await render(<IntegrationsScreen />);
    await waitFor(() => expect(getByText('Oura')).toBeTruthy());
    await fireEvent.press(getByText('Oura'));
    await fireEvent.press(getByText('Connect Oura'));

    await waitFor(() => expect(mockStartOuraConnectMutateAsync).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(Linking.openURL).toHaveBeenCalledWith('https://cloud.ouraring.com/oauth/authorize?state=abc'),
    );
    // Not gated, unlike Whoop — a free user never gets sent to the paywall.
    expect(mockNavigate).not.toHaveBeenCalled();
    // Whoop's/Spotify's own connect mutations are untouched by an Oura-card tap.
    expect(mockStartConnectMutateAsync).not.toHaveBeenCalled();
    expect(mockStartSpotifyConnectMutateAsync).not.toHaveBeenCalled();
  });

  it('shows Connected status and a Disconnect action once a connection has an access token', async () => {
    mockUseIntegrationConnections.mockReturnValue({
      data: [
        {
          id: 'conn-1',
          user_id: 'user-1',
          provider: 'whoop',
          client_id: null,
          client_secret: null,
          access_token: 'whoop-access-token',
          refresh_token: 'whoop-refresh-token',
          token_expires_at: '2026-01-01T00:00:00.000Z',
          created_at: '',
          updated_at: '',
        },
      ],
      isLoading: false,
      refetch: mockRefetch,
    });

    const { getByText } = await render(<IntegrationsScreen />);
    await waitFor(() => expect(getByText('Connected')).toBeTruthy());

    await fireEvent.press(getByText('Whoop'));
    expect(getByText('Disconnect')).toBeTruthy();
  });

  it('disconnects the integration after confirming', async () => {
    mockUseIntegrationConnections.mockReturnValue({
      data: [
        {
          id: 'conn-1',
          user_id: 'user-1',
          provider: 'whoop',
          client_id: null,
          client_secret: null,
          access_token: 'whoop-access-token',
          refresh_token: 'whoop-refresh-token',
          token_expires_at: '2026-01-01T00:00:00.000Z',
          created_at: '',
          updated_at: '',
        },
      ],
      isLoading: false,
      refetch: mockRefetch,
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const disconnectButton = buttons?.find(b => b.text === 'Disconnect');
      disconnectButton?.onPress?.();
    });

    const { getByText } = await render(<IntegrationsScreen />);
    await waitFor(() => expect(getByText('Connected')).toBeTruthy());
    await fireEvent.press(getByText('Whoop'));
    await fireEvent.press(getByText('Disconnect'));

    expect(mockDisconnectMutate).toHaveBeenCalledWith({ userId: 'user-1', provider: 'whoop' });
    alertSpy.mockRestore();
  });

  describe('arriving via the soset://whoop-callback deep link', () => {
    it('shows a success alert, auto-expands the card, and clears the route params', async () => {
      mockRouteParams = { status: 'success' };
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

      const { getByText } = await render(<IntegrationsScreen />);

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith('Connected', 'Your account is now connected to SetSocial.'),
      );
      // Auto-expanded — no tap on "Whoop" needed to reveal the card body.
      expect(getByText('Connect Whoop')).toBeTruthy();
      expect(mockSetParams).toHaveBeenCalledWith({ status: undefined, message: undefined });
      alertSpy.mockRestore();
    });

    it('shows the failure message from the deep link when the connection did not succeed', async () => {
      mockRouteParams = { status: 'error', message: 'Whoop access wasn’t granted.' };
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

      await render(<IntegrationsScreen />);

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith('Connection failed', 'Whoop access wasn’t granted.'),
      );
      expect(mockSetParams).toHaveBeenCalledWith({ status: undefined, message: undefined });
      alertSpy.mockRestore();
    });

    it('does not show any alert on a normal visit with no deep-link params', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

      const { getByText } = await render(<IntegrationsScreen />);
      await waitFor(() => expect(getByText('Whoop')).toBeTruthy());

      expect(alertSpy).not.toHaveBeenCalled();
      expect(mockSetParams).not.toHaveBeenCalled();
      alertSpy.mockRestore();
    });
  });

  describe('Apple Health', () => {
    it('connecting calls the sync mutation directly — no OAuth URL, nothing opened in a browser', async () => {
      const { getByText } = await render(<IntegrationsScreen />);
      await waitFor(() => expect(getByText('Apple Health')).toBeTruthy());
      await fireEvent.press(getByText('Apple Health'));
      await fireEvent.press(getByText('Connect Apple Health'));

      expect(mockSyncMutate).toHaveBeenCalledTimes(1);
      expect(Linking.openURL).not.toHaveBeenCalled();
    });

    it('shows "Requested" (never "Connected") once a connection row exists with no successful sync yet', async () => {
      mockUseDeviceHealthConnection.mockReturnValue({
        data: { id: 'dh-1', user_id: 'user-1', source: 'apple_health', requested_at: '2026-01-01T00:00:00.000Z', last_synced_at: null },
        isLoading: false,
      });

      const { getByText, queryByText } = await render(<IntegrationsScreen />);
      await waitFor(() => expect(getByText('Requested')).toBeTruthy());
      expect(queryByText('Connected')).toBeNull();

      await fireEvent.press(getByText('Apple Health'));
      expect(getByText(/check Settings/)).toBeTruthy();
    });

    it('shows a relative "Synced" time and the raw metrics summary once a sync has actually landed data', async () => {
      mockUseDeviceHealthConnection.mockReturnValue({
        data: {
          id: 'dh-1',
          user_id: 'user-1',
          source: 'apple_health',
          requested_at: '2026-01-01T00:00:00.000Z',
          last_synced_at: new Date().toISOString(),
        },
        isLoading: false,
      });
      mockUseLatestAppleHealthMetrics.mockReturnValue({
        data: {
          id: 'm-1',
          user_id: 'user-1',
          metric_date: '2026-01-01',
          source: 'apple_health',
          resting_heart_rate: 58,
          hrv_ms: 45,
          hrv_method: 'sdnn',
          sleep_duration_minutes: 440,
          step_count: 8200,
          synced_at: '',
        },
      });

      const { getByText } = await render(<IntegrationsScreen />);
      // The collapsed header pill stays a short, fixed "Synced" — same
      // length budget as the other cards' "Connected"/"Not connected" —
      // never the full relative time, which would squeeze the name/source
      // column into an unreadable per-character wrap (see the bug this
      // regression-guards).
      await waitFor(() => expect(getByText('Synced')).toBeTruthy());

      await fireEvent.press(getByText('Apple Health'));
      expect(getByText(/^Last synced/)).toBeTruthy();
      expect(getByText(/RHR 58bpm/)).toBeTruthy();
      expect(getByText(/HRV 45ms \(SDNN\)/)).toBeTruthy();
      expect(getByText(/7h 20m/)).toBeTruthy();
      expect(getByText(/8,200 steps/)).toBeTruthy();
    });

    it('disconnecting only removes the local connection row, with copy that does not claim to revoke Health access', async () => {
      mockUseDeviceHealthConnection.mockReturnValue({
        data: { id: 'dh-1', user_id: 'user-1', source: 'apple_health', requested_at: '2026-01-01T00:00:00.000Z', last_synced_at: new Date().toISOString() },
        isLoading: false,
      });
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, message, buttons) => {
        expect(message).toMatch(/does not revoke access/);
        const disconnectButton = buttons?.find(b => b.text === 'Disconnect');
        disconnectButton?.onPress?.();
      });

      const { getByText } = await render(<IntegrationsScreen />);
      await waitFor(() => expect(getByText(/^Synced/)).toBeTruthy());
      await fireEvent.press(getByText('Apple Health'));
      await fireEvent.press(getByText('Disconnect'));

      expect(mockDisconnectAppleHealthMutate).toHaveBeenCalledTimes(1);
      alertSpy.mockRestore();
    });
  });
});
