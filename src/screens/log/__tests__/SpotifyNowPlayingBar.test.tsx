import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SpotifyNowPlayingBar } from '../SpotifyNowPlayingBar';

jest.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { userId: string | null }) => unknown) => selector({ userId: 'user-1' }),
}));

const mockUseIntegrationConnections = jest.fn();
jest.mock('../../../services/api/queries/integrations', () => ({
  useIntegrationConnections: (...args: unknown[]) => mockUseIntegrationConnections(...args),
}));

const mockUseSpotifyNowPlaying = jest.fn();
const mockControlMutate = jest.fn();
jest.mock('../../../services/api/queries/spotify', () => ({
  useSpotifyNowPlaying: (...args: unknown[]) => mockUseSpotifyNowPlaying(...args),
  useSpotifyPlaybackControl: () => ({ mutate: mockControlMutate }),
}));

const CONNECTED = [
  {
    id: 'conn-1',
    user_id: 'user-1',
    provider: 'spotify',
    client_id: null,
    client_secret: null,
    access_token: 'spotify-access-token',
    refresh_token: 'spotify-refresh-token',
    token_expires_at: '2026-01-01T00:00:00.000Z',
    created_at: '',
    updated_at: '',
  },
];

const PLAYING_TRACK = {
  action: 'now_playing' as const,
  result: {
    is_playing: true,
    progress_ms: 30000,
    item: {
      name: 'Eye of the Tiger',
      duration_ms: 120000,
      artists: [{ name: 'Survivor' }],
      album: { images: [{ url: 'https://example.com/art.jpg' }] },
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseIntegrationConnections.mockReturnValue({ data: CONNECTED, isLoading: false });
  // Argument-aware, like the real hook: disabled (not connected) means no
  // data, same as the query never having run.
  mockUseSpotifyNowPlaying.mockImplementation((enabled: boolean) => ({ data: enabled ? PLAYING_TRACK : undefined }));
});

describe('SpotifyNowPlayingBar', () => {
  it('renders nothing when Spotify is not connected', async () => {
    mockUseIntegrationConnections.mockReturnValue({ data: [], isLoading: false });

    const { toJSON } = await render(<SpotifyNowPlayingBar />);
    expect(toJSON()).toBeNull();
    // Not connected — the now-playing query shouldn't be enabled at all.
    expect(mockUseSpotifyNowPlaying).toHaveBeenCalledWith(false);
  });

  it('renders nothing when connected but nothing is currently playing', async () => {
    mockUseSpotifyNowPlaying.mockReturnValue({ data: { action: 'now_playing', result: null } });

    const { toJSON } = await render(<SpotifyNowPlayingBar />);
    expect(toJSON()).toBeNull();
  });

  it('shows track, artist, art, and a proportional progress fill when something is playing', async () => {
    const { getByText, getByTestId } = await render(<SpotifyNowPlayingBar />);

    expect(getByText('Eye of the Tiger')).toBeTruthy();
    expect(getByText('Survivor')).toBeTruthy();
    // 30000 / 120000 = 25%.
    expect(getByTestId('spotify-progress-fill').props.style.width).toBe('25%');
  });

  it('shows Pause (not Play) while a track is playing, and pauses on tap', async () => {
    const { getByLabelText, queryByLabelText } = await render(<SpotifyNowPlayingBar />);

    expect(getByLabelText('Pause')).toBeTruthy();
    expect(queryByLabelText('Play')).toBeNull();

    await fireEvent.press(getByLabelText('Pause'));
    expect(mockControlMutate).toHaveBeenCalledWith('pause', expect.anything());
  });

  it('shows Play when paused, and resumes on tap', async () => {
    mockUseSpotifyNowPlaying.mockReturnValue({
      data: { action: 'now_playing', result: { ...PLAYING_TRACK.result, is_playing: false } },
    });

    const { getByLabelText } = await render(<SpotifyNowPlayingBar />);
    await fireEvent.press(getByLabelText('Play'));
    expect(mockControlMutate).toHaveBeenCalledWith('play', expect.anything());
  });

  it('skips to the previous track on tap', async () => {
    const { getByLabelText } = await render(<SpotifyNowPlayingBar />);

    await fireEvent.press(getByLabelText('Previous track'));
    expect(mockControlMutate).toHaveBeenCalledWith('previous', expect.anything());
  });

  it('skips to the next track on tap', async () => {
    const { getByLabelText } = await render(<SpotifyNowPlayingBar />);

    await fireEvent.press(getByLabelText('Next track'));
    expect(mockControlMutate).toHaveBeenCalledWith('next', expect.anything());
  });

  it('shows an alert if a playback control fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockControlMutate.mockImplementation((_action, { onError }) => onError(new Error('No active device')));

    const { getByLabelText } = await render(<SpotifyNowPlayingBar />);
    await fireEvent.press(getByLabelText('Previous track'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Spotify', 'No active device'));
    alertSpy.mockRestore();
  });
});
