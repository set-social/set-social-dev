import React from 'react';
import { Alert, Image, Pressable, StyleSheet, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Icon } from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useIntegrationConnections } from '../../services/api/queries/integrations';
import { useSpotifyNowPlaying, useSpotifyPlaybackControl } from '../../services/api/queries/spotify';

const ART_SIZE = 56;
const PLAY_SIZE = 52;
const SIDE_BUTTON_SIZE = 40;

/**
 * Elevated "now playing" card for the active-set logging screen — album
 * art, track/artist, a full prev/play-pause/next transport row, and a
 * proper progress track. Rendered above FocusedExerciseHeader and outside
 * the screen's ScrollView (see ActiveExerciseScreen), so it stays fixed in
 * place while sets scroll underneath instead of scrolling away with them.
 *
 * Renders nothing — not an empty/disabled card — when Spotify isn't
 * connected or nothing is currently playing on any device; there's nothing
 * useful to show or control in either case.
 */
export function SpotifyNowPlayingBar() {
  const theme = useTheme();
  const userId = useAuthStore(state => state.userId);
  const { data: connections } = useIntegrationConnections(userId);
  const isConnected = connections?.some(c => c.provider === 'spotify' && c.access_token != null) ?? false;

  const { data } = useSpotifyNowPlaying(isConnected);
  const control = useSpotifyPlaybackControl();

  const playback = data?.result;
  const track = playback?.item;

  if (!track) return null;

  const onControl = (action: 'play' | 'pause' | 'previous' | 'next') => {
    control.mutate(action, {
      onError: err => {
        Alert.alert(
          'Spotify',
          err instanceof Error
            ? err.message
            : 'Could not control playback. Open Spotify on a device and try again.',
        );
      },
    });
  };

  const progressPct =
    track.duration_ms > 0
      ? Math.min(100, Math.max(0, ((playback?.progress_ms ?? 0) / track.duration_ms) * 100))
      : 0;
  const artUrl = track.album.images[0]?.url;
  const artistNames = track.artists.map(a => a.name).join(', ');
  const isPlaying = playback?.is_playing ?? false;

  return (
    <View
      style={{
        backgroundColor: theme.colors.bg.base,
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.md,
      }}
    >
      <View
        style={[
          {
            backgroundColor: theme.colors.bg.surface,
            borderRadius: theme.radii.lg,
            borderWidth: 1,
            borderColor: theme.colors.border.subtle,
            padding: theme.spacing.md,
          },
          theme.shadows.md,
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <View
            style={{
              width: ART_SIZE,
              height: ART_SIZE,
              borderRadius: theme.radii.md,
              overflow: 'hidden',
              backgroundColor: theme.colors.bg.surfaceElevated,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {artUrl ? (
              <Image source={{ uri: artUrl }} style={{ width: ART_SIZE, height: ART_SIZE }} resizeMode="cover" />
            ) : (
              <Icon name="music" size="md" color={theme.colors.text.tertiary} />
            )}
          </View>

          <View style={{ flex: 1 }}>
            <Text variant="subtitle" numberOfLines={1}>
              {track.name}
            </Text>
            <Text variant="caption" color="secondary" numberOfLines={1}>
              {artistNames}
            </Text>
          </View>
        </View>

        <View
          style={{
            height: 4,
            borderRadius: theme.radii.pill,
            backgroundColor: theme.colors.bg.surfaceElevated,
            marginTop: theme.spacing.md,
            overflow: 'hidden',
          }}
        >
          <View
            testID="spotify-progress-fill"
            style={{ height: 4, width: `${progressPct}%`, backgroundColor: theme.colors.accent.primary }}
          />
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.spacing.xl,
            marginTop: theme.spacing.md,
          }}
        >
          <Pressable
            onPress={() => onControl('previous')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Previous track"
            style={{
              width: SIDE_BUTTON_SIZE,
              height: SIDE_BUTTON_SIZE,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="skipBack" size="md" color={theme.colors.text.primary} />
          </Pressable>

          <Pressable
            onPress={() => onControl(isPlaying ? 'pause' : 'play')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
            style={{
              width: PLAY_SIZE,
              height: PLAY_SIZE,
              borderRadius: PLAY_SIZE / 2,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <LinearGradient
              colors={[...theme.gradients.accent]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <Icon name={isPlaying ? 'pause' : 'play'} size="md" color={theme.colors.text.onAccent} />
          </Pressable>

          <Pressable
            onPress={() => onControl('next')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Next track"
            style={{
              width: SIDE_BUTTON_SIZE,
              height: SIDE_BUTTON_SIZE,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="skipForward" size="md" color={theme.colors.text.primary} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
