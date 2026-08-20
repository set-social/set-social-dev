import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Text,
  Card,
  Header,
  Button,
  Icon,
  LoadingState,
  BetaBadge,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useProfile } from '../../services/api/queries/profiles';
import {
  useIntegrationConnections,
  useStartWhoopConnect,
  useStartSpotifyConnect,
  useStartOuraConnect,
  useDisconnectIntegration,
} from '../../services/api/queries/integrations';
import {
  isAppleHealthAvailable,
  useDeviceHealthConnection,
  useLatestAppleHealthMetrics,
  useSyncAppleHealth,
  useDisconnectAppleHealth,
} from '../../services/api/queries/appleHealth';
import type { ProfileStackParamList } from '../../navigation/types';
import type { IntegrationProvider } from '../../types/database';
import type { IconName } from '../../components/core';

type Route = RouteProp<ProfileStackParamList, 'Integrations'>;
type Nav = NativeStackNavigationProp<ProfileStackParamList>;

/** No integration currently requires SetSocial Pro — Whoop, Oura, and
 * Spotify are all free. */
function requiresPremium(_provider: IntegrationProvider): boolean {
  return false;
}

type IntegrationCategory = 'wearable' | 'convenience';

type IntegrationDef = {
  provider: IntegrationProvider;
  name: string;
  source: string;
  description: string;
  icon: IconName;
  category: IntegrationCategory;
  /** Shows a small "Beta" pip next to the name — for a provider whose
   * integration is newer/less battle-tested than the others (e.g. Oura,
   * just added) rather than a signal about the provider itself. */
  beta?: boolean;
};

// Apple Health has no OAuth handshake, so it's rendered by a separate
// AppleHealthCard component (below) rather than the shared IntegrationCard
// — but it still lives in this same INTEGRATIONS list/CATEGORY_SECTIONS
// loop so "every integration is one row in this screen" stays true. iOS
// only for Phase 1 (see docs/apple-health.md) — Android gets nothing here
// until Health Connect (Phase 2) ships.
const DEVICE_HEALTH_PROVIDERS = new Set<IntegrationProvider>(['apple_health', 'health_connect']);

const INTEGRATIONS: IntegrationDef[] = [
  {
    provider: 'whoop',
    name: 'Whoop',
    source: 'Recovery, sleep & readiness',
    description:
      'Connect your Whoop account to bring recovery, sleep, and readiness data into SetSocial — Arnold uses it to adjust each day’s session.',
    icon: 'activity',
    category: 'wearable',
  },
  {
    provider: 'oura',
    name: 'Oura',
    source: 'Readiness, sleep & activity',
    description:
      'Connect your Oura Ring to bring readiness, sleep, and activity data into SetSocial — Arnold uses it to adjust each day’s session. Free for everyone.',
    icon: 'moon',
    category: 'wearable',
    beta: true,
  },
  ...(Platform.OS === 'ios'
    ? [
        {
          provider: 'apple_health',
          name: 'Apple Health',
          source: 'Resting heart rate, HRV, sleep & steps',
          description:
            'Reads resting heart rate, heart rate variability, sleep, and step count from Health so Arnold has more context — shown to you as raw numbers only, it never changes your computed readiness score. Free for everyone.',
          icon: 'heart',
          category: 'wearable',
          beta: true,
        } satisfies IntegrationDef,
      ]
    : []),
  {
    provider: 'spotify',
    name: 'Spotify',
    source: 'Playback control & playlists',
    description:
      'Connect Spotify to see and control what’s playing during a workout, and attach one of your playlists to a training day.',
    icon: 'music',
    category: 'convenience',
  },
];

const CATEGORY_SECTIONS: { category: IntegrationCategory; label: string }[] = [
  { category: 'wearable', label: 'WEARABLES' },
  { category: 'convenience', label: 'CONVENIENCE' },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text variant="label" color="secondary">
      {children}
    </Text>
  );
}

function StatusPill({ connected }: { connected: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xxs,
        borderRadius: theme.radii.pill,
        backgroundColor: connected
          ? theme.colors.accent.subtle
          : theme.colors.bg.surfaceElevated,
      }}
    >
      <Text
        variant="caption"
        style={{
          color: connected
            ? theme.colors.accent.primary
            : theme.colors.text.tertiary,
          fontWeight: '600',
        }}
      >
        {connected ? 'Connected' : 'Not connected'}
      </Text>
    </View>
  );
}

/** Three states, not two — deliberately never says "Connected." HealthKit
 * never tells the app which data types were actually granted (see
 * docs/apple-health.md's "Permission UX"), so the only honest claim is
 * whether a sync has actually returned data: 'none' (no connection row
 * yet), 'requested' (row exists, no successful sync yet — could mean
 * denied, could mean no data exists yet in Health), or 'synced' once one
 * has landed. Kept to a single short word each, same length budget as the
 * other cards' fixed "Connected"/"Not connected" pill — the *when* (a
 * relative time) renders separately in the expanded body instead of inside
 * this pill, which sits in a row next to the name/source column and has no
 * room to absorb a long string without squeezing that column into an
 * unreadable per-character wrap. */
function AppleHealthStatusPill({
  state,
}: {
  state: { kind: 'none' } | { kind: 'requested' } | { kind: 'synced'; at: string };
}) {
  const theme = useTheme();
  const active = state.kind !== 'none';
  const label = state.kind === 'none' ? 'Not connected' : state.kind === 'requested' ? 'Requested' : 'Synced';
  return (
    <View
      style={{
        flexShrink: 0,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xxs,
        borderRadius: theme.radii.pill,
        backgroundColor: active ? theme.colors.accent.subtle : theme.colors.bg.surfaceElevated,
      }}
    >
      <Text
        variant="caption"
        numberOfLines={1}
        style={{
          color: active ? theme.colors.accent.primary : theme.colors.text.tertiary,
          fontWeight: '600',
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function AppleHealthMetricsSummary({ userId, lastSyncedAt }: { userId: string; lastSyncedAt: string }) {
  const { data: metrics } = useLatestAppleHealthMetrics(userId);
  const bits: string[] = [];
  if (metrics?.resting_heart_rate != null) bits.push(`RHR ${metrics.resting_heart_rate}bpm`);
  if (metrics?.hrv_ms != null) bits.push(`HRV ${metrics.hrv_ms}ms (SDNN)`);
  if (metrics?.sleep_duration_minutes != null) {
    const hours = Math.floor(metrics.sleep_duration_minutes / 60);
    const minutes = metrics.sleep_duration_minutes % 60;
    bits.push(`Sleep ${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`);
  }
  if (metrics?.step_count != null) bits.push(`${metrics.step_count.toLocaleString()} steps`);
  return (
    <Text variant="caption" color="secondary">
      {`Last synced ${formatDistanceToNow(new Date(lastSyncedAt), { addSuffix: true })}`}
      {bits.length > 0 ? `\n${bits.join(' · ')}` : ''}
    </Text>
  );
}

function AppleHealthCard({ def, userId }: { def: IntegrationDef; userId: string | null }) {
  const theme = useTheme();
  const { data: connection, isLoading } = useDeviceHealthConnection(userId);
  const sync = useSyncAppleHealth(userId);
  const disconnect = useDisconnectAppleHealth(userId);
  const [expanded, setExpanded] = useState(false);
  const available = isAppleHealthAvailable();

  const status: React.ComponentProps<typeof AppleHealthStatusPill>['state'] = !connection
    ? { kind: 'none' }
    : connection.last_synced_at
    ? { kind: 'synced', at: connection.last_synced_at }
    : { kind: 'requested' };

  // Re-sync on every focus once already connected — the closest Phase 1
  // equivalent of Whoop/Oura's screen-focus refetch, except there's no
  // remote round-trip to wait on, so this re-reads HealthKit directly
  // rather than just refetching a cached Supabase row. Never fires for a
  // never-connected user — no permission prompt should appear just from
  // opening this screen.
  useFocusEffect(
    useCallback(() => {
      if (connection && !sync.isPending) sync.mutate();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connection?.id]),
  );

  const onConnect = () => {
    sync.mutate(undefined, {
      onError: err => {
        Alert.alert(
          'Could not connect',
          err instanceof Error ? err.message : 'Please try again.',
        );
      },
    });
  };

  const onDisconnect = () => {
    Alert.alert(
      'Disconnect Apple Health?',
      'SetSocial will stop reading your Health data. This does not revoke access in Health itself — to fully remove it, go to Settings > Health > Data Access & Devices > SetSocial.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => disconnect.mutate() },
      ],
    );
  };

  return (
    <Card variant="elevated" style={{ gap: theme.spacing.sm }}>
      <Pressable
        onPress={() => setExpanded(e => !e)}
        accessibilityRole="button"
        accessibilityLabel={`${def.name}, ${status.kind === 'none' ? 'not connected' : status.kind}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
      >
        <View
          style={{
            width: theme.sizes.iconButton,
            height: theme.sizes.iconButton,
            borderRadius: theme.radii.md,
            backgroundColor: theme.colors.bg.surfaceElevated,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={def.icon} size="sm" color={theme.colors.text.secondary} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="body" style={{ fontWeight: '700' }}>
              {def.name}
            </Text>
            {def.beta ? <BetaBadge /> : null}
          </View>
          <Text variant="caption" color="secondary">
            {def.source}
          </Text>
        </View>
        <AppleHealthStatusPill state={status} />
        <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size="sm" color={theme.colors.text.tertiary} />
      </Pressable>

      {expanded ? (
        isLoading ? (
          <LoadingState fill={false} />
        ) : !available ? (
          <Text variant="caption" color="secondary">
            Health isn't available on this device.
          </Text>
        ) : (
          <View style={{ gap: theme.spacing.md, paddingTop: theme.spacing.xs }}>
            <Text variant="caption" color="secondary">
              {def.description}
            </Text>
            {userId && status.kind === 'synced' ? (
              <AppleHealthMetricsSummary userId={userId} lastSyncedAt={status.at} />
            ) : null}
            {status.kind === 'requested' ? (
              <Text variant="caption" color="secondary">
                Requested — if numbers don't show up after opening Health
                once, check Settings &gt; Health &gt; Data Access &amp;
                Devices &gt; SetSocial.
              </Text>
            ) : null}
            {connection ? (
              <Button label="Disconnect" variant="ghost" onPress={onDisconnect} loading={disconnect.isPending} />
            ) : (
              <Button label="Connect Apple Health" onPress={onConnect} loading={sync.isPending} />
            )}
          </View>
        )
      ) : null}
    </Card>
  );
}

function IntegrationCard({
  def,
  userId,
  initiallyExpanded,
  isPremium,
}: {
  def: IntegrationDef;
  userId: string | null;
  initiallyExpanded: boolean;
  isPremium: boolean;
}) {
  const theme = useTheme();
  const {
    data: connections,
    isLoading,
    refetch,
  } = useIntegrationConnections(userId);
  // Rules of hooks: all start-connect mutations are always called, then the
  // one matching this card's provider is picked below — same fixed-provider-
  // set pattern as INTEGRATIONS itself, so this grows by one line per new
  // provider rather than needing conditional hook calls.
  const startWhoopConnect = useStartWhoopConnect();
  const startSpotifyConnect = useStartSpotifyConnect();
  const startOuraConnect = useStartOuraConnect();
  const startConnect =
    def.provider === 'whoop'
      ? startWhoopConnect
      : def.provider === 'oura'
      ? startOuraConnect
      : startSpotifyConnect;
  const disconnect = useDisconnectIntegration();
  const connection =
    connections?.find(c => c.provider === def.provider) ?? null;
  const isConnected = connection?.access_token != null;

  const [expanded, setExpanded] = useState(initiallyExpanded);

  // Refetch whenever this screen regains focus — covers the user switching
  // back from the system browser after approving (or denying) Whoop access,
  // so "Connected" appears without a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const onConnect = async () => {
    if (!userId) return;
    try {
      const { url } = await startConnect.mutateAsync();
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) throw new Error('No browser available to open this link.');
      await Linking.openURL(url);
    } catch (err) {
      Alert.alert(
        'Could not start connection',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  };

  const onDisconnect = () => {
    if (!userId) return;
    Alert.alert(
      `Disconnect ${def.name}?`,
      `SetSocial will stop reading your ${def.name} data. You can reconnect any time.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => disconnect.mutate({ userId, provider: def.provider }),
        },
      ],
    );
  };

  return (
    <Card variant="elevated" style={{ gap: theme.spacing.sm }}>
      <Pressable
        onPress={() => setExpanded(e => !e)}
        accessibilityRole="button"
        accessibilityLabel={`${def.name}, ${
          isConnected ? 'connected' : 'not connected'
        }`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
        }}
      >
        <View
          style={{
            width: theme.sizes.iconButton,
            height: theme.sizes.iconButton,
            borderRadius: theme.radii.md,
            backgroundColor: theme.colors.bg.surfaceElevated,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={def.icon} size="sm" color={theme.colors.text.secondary} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="body" style={{ fontWeight: '700' }}>
              {def.name}
            </Text>
            {def.beta ? <BetaBadge /> : null}
          </View>
          <Text variant="caption" color="secondary">
            {def.source}
          </Text>
        </View>
        <StatusPill connected={isConnected} />
        <Icon
          name={expanded ? 'chevronUp' : 'chevronDown'}
          size="sm"
          color={theme.colors.text.tertiary}
        />
      </Pressable>

      {expanded ? (
        isLoading ? (
          <LoadingState fill={false} />
        ) : (
          <View style={{ gap: theme.spacing.md, paddingTop: theme.spacing.xs }}>
            <Text variant="caption" color="secondary">
              {def.description}
            </Text>
            {requiresPremium(def.provider) && !isPremium ? (
              <Text
                variant="caption"
                style={{
                  color: theme.colors.semantic.warning,
                  fontWeight: '600',
                }}
              >
                Part of SetSocial Pro
              </Text>
            ) : null}
            {isConnected ? (
              <Button
                label="Disconnect"
                variant="ghost"
                onPress={onDisconnect}
                loading={disconnect.isPending}
              />
            ) : (
              <Button
                label={
                  requiresPremium(def.provider) && !isPremium
                    ? `Unlock ${def.name}`
                    : `Connect ${def.name}`
                }
                icon={
                  requiresPremium(def.provider) && !isPremium
                    ? 'crown'
                    : undefined
                }
                gradientColors={
                  requiresPremium(def.provider) && !isPremium
                    ? theme.gradients.premium
                    : undefined
                }
                onPress={onConnect}
                loading={startConnect.isPending}
              />
            )}
          </View>
        )
      ) : null}
    </Card>
  );
}

export function IntegrationsScreen() {
  const theme = useTheme();
  const userId = useAuthStore(state => state.userId);
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const queryClient = useQueryClient();
  const { data: profile } = useProfile(userId);

  // Only ever set when this screen was reached via a soset://{provider}-callback
  // deep link (see RootNavigator's `linking` config) — a normal tap into
  // Integrations from Settings never has these. Consumed once: cleared
  // immediately via setParams so backgrounding/refocusing the app doesn't
  // re-show the same alert.
  //
  // The alert copy stays provider-agnostic ("connected" rather than naming
  // Whoop/Spotify/Oura) because the `alias` config that routes all three
  // callback paths to this one screen doesn't tell us which alias actually
  // matched (see RootNavigator) — only `status`/`message` come through as
  // route params. The error message is still specific per-provider, since
  // that text is authored server-side in each *-oauth-callback function.
  //
  // Invalidates directly here rather than relying on IntegrationCard's
  // useFocusEffect refetch: if this screen was already focused when the user
  // left for the browser flow (they never navigated away in-app), the deep
  // link updates route params without a blur->focus transition, so
  // useFocusEffect never re-fires and the pill is stuck showing stale data
  // until the app is restarted.
  useEffect(() => {
    if (!params?.status) return;
    if (params.status === 'success') {
      Alert.alert('Connected', 'Your account is now connected to SetSocial.');
    } else {
      Alert.alert(
        'Connection failed',
        params.message ?? 'Could not connect. Please try again.',
      );
    }
    queryClient.invalidateQueries({
      queryKey: ['integrationConnections', userId],
    });
    navigation.setParams({ status: undefined, message: undefined });
  }, [params?.status, params?.message, navigation, queryClient, userId]);

  // Belt-and-suspenders fallback: if the OS hands the app back to the
  // foreground without React Navigation ever processing the soset:// URL
  // (e.g. the user manually switched back via the app switcher instead of
  // tapping the "Open in SetSocial" system prompt), neither effect above
  // runs at all. Refetching on every foreground transition catches that case
  // too.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        queryClient.invalidateQueries({
          queryKey: ['integrationConnections', userId],
        });
      }
    });
    return () => subscription.remove();
  }, [queryClient, userId]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <Header title="Integrations" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingTop: 0,
          gap: theme.spacing.lg,
        }}
      >
        <Text variant="body" color="secondary">
          Connect third-party fitness platforms to bring their data into
          SetSocial.
        </Text>
        {CATEGORY_SECTIONS.map(section => {
          const defs = INTEGRATIONS.filter(
            def => def.category === section.category,
          );
          if (defs.length === 0) return null;
          return (
            <View key={section.category} style={{ gap: theme.spacing.sm }}>
              <SectionLabel>{section.label}</SectionLabel>
              <View style={{ gap: theme.spacing.md }}>
                {defs.map(def =>
                  DEVICE_HEALTH_PROVIDERS.has(def.provider) ? (
                    <AppleHealthCard key={def.provider} def={def} userId={userId} />
                  ) : (
                    <IntegrationCard
                      key={def.provider}
                      def={def}
                      userId={userId}
                      initiallyExpanded={params?.status != null}
                      isPremium={profile?.is_premium ?? false}
                    />
                  ),
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
