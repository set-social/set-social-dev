import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Linking, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { MAP_PROVIDER } from '../../utils/mapProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Card, Button, Numeral } from '../../components/core';
import {
  useActiveCardioStore,
  computeElapsedSeconds,
  MAX_PLAUSIBLE_CARDIO_SESSION_MS,
  type CardioSessionSource,
} from '../../store/activeCardioStore';
import {
  requestCardioTrackingPermission,
  startRouteTracking,
  stopRouteTracking,
} from '../../services/location/routeTracking';
import { LocationUnavailableError } from '../../services/location/currentLocation';
import { computeDistanceKm, computePaceSecPerKm, formatDuration, formatPace } from '../../utils/routeMetrics';
import { TAB_BAR_FLOAT_FOOTPRINT } from '../../navigation/MainTabs';
import { SlideToCancelBar } from './SlideToCancelBar';
import type { ProgramsStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<ProgramsStackParamList>;
type Route = RouteProp<ProgramsStackParamList, 'LiveCardioTracking'>;

/** Below this gap, backgrounding is treated as routine (switching apps for
 * a few seconds) and doesn't warrant interrupting the runner with a
 * banner — see docs/gps-cardio.md's background-tracking notes. */
const NOTABLE_GAP_SECONDS = 20;

type PermissionState = 'checking' | 'granted' | 'denied';

export function LiveCardioTrackingScreen() {
  const theme = useTheme();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();

  const status = useActiveCardioStore(state => state.status);
  const points = useActiveCardioStore(state => state.points);
  const startedAt = useActiveCardioStore(state => state.startedAt);
  const pausedAt = useActiveCardioStore(state => state.pausedAt);
  const pausedMs = useActiveCardioStore(state => state.pausedMs);
  const finishedAt = useActiveCardioStore(state => state.finishedAt);
  const startSession = useActiveCardioStore(state => state.startSession);
  const pauseSession = useActiveCardioStore(state => state.pauseSession);
  const resumeSession = useActiveCardioStore(state => state.resumeSession);
  const finishSession = useActiveCardioStore(state => state.finishSession);
  const discardSession = useActiveCardioStore(state => state.discardSession);

  const [permission, setPermission] = useState<PermissionState>('checking');
  const [, setTick] = useState(0);
  const [gapMessage, setGapMessage] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const mapRef = useRef<MapView | null>(null);
  const lastPointAtRef = useRef<number | null>(null);
  const wasBackgroundedRef = useRef(false);

  // Starts exactly once per screen mount that finds no session already in
  // progress — a remount while `status` is already 'tracking'/'paused'
  // (e.g. this screen briefly unmounted/remounted around a backgrounding
  // event) must not call startSession again and wipe the in-progress route.
  useEffect(() => {
    let cancelled = false;
    // A 'finished' session belongs on CardioRunSummaryScreen, which already
    // clears the store back to idle on both discard and a successful save —
    // encountering 'finished' here always means a leftover from a failed
    // save the athlete backed out of, never a session to resume.
    // 'tracking'/'paused' can legitimately survive a remount (e.g. around a
    // backgrounding event), but not indefinitely — one old enough to be
    // implausible is a session abandoned by a crash/force-quit, not one
    // still actually in progress. Either case gets discarded rather than
    // resumed, so a fresh "Start a Run" tap doesn't silently inherit a
    // leftover session's ancient startedAt (see MAX_PLAUSIBLE_CARDIO_SESSION_MS).
    const isAbandoned =
      status === 'finished' ||
      ((status === 'tracking' || status === 'paused') &&
        startedAt != null &&
        Date.now() - startedAt > MAX_PLAUSIBLE_CARDIO_SESSION_MS);
    if (isAbandoned) {
      discardSession();
    } else if (status !== 'idle') {
      setPermission('granted');
      return;
    }
    requestCardioTrackingPermission().then(result => {
      if (cancelled) return;
      if (!result.foreground) {
        setPermission('denied');
        return;
      }
      setPermission('granted');
      const source: CardioSessionSource = { programDayId: params.programDayId ?? null, date: params.date };
      startSession({
        source,
        activityKey: params.activityKey,
        exerciseId: params.exerciseId,
        customActivityName: params.customActivityName,
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Begins the actual GPS watch once permission is confirmed and a session
  // exists to record into — separate effect from the one above so a
  // resumed/already-tracking session (status !== 'idle' on mount) also
  // re-establishes its native watch, not just a freshly-started one.
  // Depends on `isSessionActive` (tracking OR paused), not the raw status
  // string — pausing is handled entirely by activeCardioStore.addPoint's
  // own no-op guard, not by tearing down and re-establishing the native
  // watch on every Pause/Resume tap.
  const isSessionActive = status === 'tracking' || status === 'paused';
  useEffect(() => {
    if (permission !== 'granted' || !isSessionActive) return;
    if (watchIdRef.current != null) return;
    watchIdRef.current = startRouteTracking(
      point => {
        lastPointAtRef.current = Date.now();
        useActiveCardioStore.getState().addPoint(point);
        mapRef.current?.animateToRegion(
          { latitude: point.latitude, longitude: point.longitude, latitudeDelta: 0.006, longitudeDelta: 0.006 },
          400,
        );
      },
      error => {
        if (error instanceof LocationUnavailableError) {
          Alert.alert('Lost location signal', error.message);
        }
      },
    );
    return () => {
      if (watchIdRef.current != null) {
        stopRouteTracking(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [permission, isSessionActive]);

  // Live stat readout ticks once a second while actively tracking.
  useEffect(() => {
    if (status !== 'tracking') return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  // Surfaces an honest gap banner only when points actually stopped
  // arriving for a while during a backgrounding — not on every
  // app-switch, and not just because the app *was* backgrounded (Phase 2's
  // background tracking may well have kept recording the whole time).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'background') {
        wasBackgroundedRef.current = true;
        return;
      }
      if (nextState === 'active' && wasBackgroundedRef.current) {
        wasBackgroundedRef.current = false;
        const lastPointAt = lastPointAtRef.current;
        if (lastPointAt == null) return;
        const gapSeconds = (Date.now() - lastPointAt) / 1000;
        if (gapSeconds >= NOTABLE_GAP_SECONDS) {
          setGapMessage(`Route paused — ${formatDuration(gapSeconds)} of tracking gap`);
        }
      }
    });
    return () => subscription.remove();
  }, []);

  const elapsedSeconds = useMemo(
    () => computeElapsedSeconds({ startedAt, pausedAt, pausedMs, finishedAt }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startedAt, pausedAt, pausedMs, finishedAt, points.length],
  );
  const distanceKm = useMemo(() => computeDistanceKm(points), [points]);
  const avgPaceSecPerKm = computePaceSecPerKm(distanceKm, elapsedSeconds);
  const currentPaceSecPerKm = useMemo(() => {
    // Instantaneous-ish pace from roughly the last 60s of points — a plain
    // avg-since-start reads as sluggish to react to a real pace change.
    const cutoff = Date.now() - 60_000;
    const recent = points.filter(p => p.recordedAt >= cutoff);
    if (recent.length < 2) return avgPaceSecPerKm;
    const recentKm = computeDistanceKm(recent);
    const recentSeconds = (recent[recent.length - 1].recordedAt - recent[0].recordedAt) / 1000;
    return computePaceSecPerKm(recentKm, recentSeconds) ?? avgPaceSecPerKm;
  }, [points, avgPaceSecPerKm]);

  const onFinish = () => {
    if (watchIdRef.current != null) {
      stopRouteTracking(watchIdRef.current);
      watchIdRef.current = null;
    }
    finishSession();
    navigation.replace('CardioRunSummary');
  };

  // No confirmation Alert — SlideToCancelBar's own deliberate drag gesture
  // already serves as the confirmation (same reasoning as iOS's "slide to
  // power off"), so a second modal on top of it would just be redundant
  // friction. Replaces the old instant-tap X button, which was both too
  // easy to trigger by accident and sat where the floating tab bar's touch
  // area overlaps the top of the screen.
  const onCancelRun = () => {
    if (watchIdRef.current != null) {
      stopRouteTracking(watchIdRef.current);
      watchIdRef.current = null;
    }
    discardSession();
    navigation.goBack();
  };

  if (permission === 'denied') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
        <View
          style={{
            flex: 1,
            padding: theme.spacing.lg,
            justifyContent: 'center',
            gap: theme.spacing.lg,
          }}
        >
          <Text variant="title" style={{ textAlign: 'center' }}>
            Location access needed
          </Text>
          <Text variant="body" color="secondary" style={{ textAlign: 'center' }}>
            SetSocial needs location access to track your route live — you can still log this
            session manually.
          </Text>
          <Button label="Enter Manually" onPress={() => navigation.goBack()} />
          <Button label="Open Settings" variant="secondary" onPress={() => Linking.openSettings()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <View
        style={{
          alignItems: 'center',
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.sm,
        }}
      >
        <Text variant="title">{params.customActivityName ?? 'Outdoor Run'}</Text>
      </View>

      <View
        style={{
          flex: 1,
          paddingHorizontal: theme.spacing.lg,
          // TAB_BAR_FLOAT_FOOTPRINT — the floating tab bar renders as a
          // position:'absolute' overlay above every ProgramsStack screen
          // (this one included), so without reserving this much space at
          // the bottom, its fixed Pause/Complete Run row sits underneath
          // the bar instead of above it. See MainTabs.tsx's own comment on
          // TAB_BAR_FLOAT_FOOTPRINT for why this is the non-scrolling-footer
          // variant (no extra insets.bottom — SafeAreaView already adds it).
          paddingBottom: theme.spacing.lg + TAB_BAR_FLOAT_FOOTPRINT,
          gap: theme.spacing.lg,
        }}
      >
        {permission === 'granted' ? (
          <View
            style={{
              height: 260,
              borderRadius: theme.radii.lg,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: theme.colors.border.subtle,
            }}
            testID="live-map-container"
          >
            <MapView
              ref={mapRef}
              style={{ flex: 1 }}
              provider={MAP_PROVIDER}
              showsUserLocation
              initialRegion={
                points.length > 0
                  ? { latitude: points[0].latitude, longitude: points[0].longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }
                  : { latitude: 0, longitude: 0, latitudeDelta: 0.01, longitudeDelta: 0.01 }
              }
            >
              {points.length > 1 ? (
                <Polyline
                  coordinates={points.map(p => ({ latitude: p.latitude, longitude: p.longitude }))}
                  strokeColor={theme.colors.accent.primary}
                  strokeWidth={4}
                />
              ) : null}
              {points.length > 0 ? (
                <Marker
                  coordinate={{ latitude: points[0].latitude, longitude: points[0].longitude }}
                  title="Start"
                />
              ) : null}
            </MapView>
          </View>
        ) : null}

        {gapMessage ? (
          <Card variant="subtle" style={{ paddingVertical: theme.spacing.sm }}>
            <Text variant="caption" style={{ color: theme.colors.semantic.warning, textAlign: 'center' }}>
              {gapMessage}
            </Text>
          </Card>
        ) : null}

        <View style={{ alignItems: 'center' }}>
          <Numeral value={distanceKm.toFixed(2)} size="xl" />
          <Text variant="label" color="secondary">
            KILOMETERS
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <Card variant="elevated" style={{ flex: 1, alignItems: 'center' }}>
            <Text variant="label" color="secondary">
              DURATION
            </Text>
            <Text variant="numeralSm">{formatDuration(elapsedSeconds)}</Text>
          </Card>
          <Card variant="elevated" style={{ flex: 1, alignItems: 'center' }}>
            <Text variant="label" color="secondary">
              CURRENT PACE
            </Text>
            <Text variant="numeralSm" style={{ color: theme.colors.accent.primary }}>
              {formatPace(currentPaceSecPerKm)}
            </Text>
          </Card>
          <Card variant="elevated" style={{ flex: 1, alignItems: 'center' }}>
            <Text variant="label" color="secondary">
              AVG PACE
            </Text>
            <Text variant="numeralSm">{formatPace(avgPaceSecPerKm)}</Text>
          </Card>
        </View>

        <View style={{ flex: 1 }} />

        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          {status === 'paused' ? (
            <Button label="Resume" onPress={resumeSession} style={{ flex: 1 }} />
          ) : (
            <Button label="Pause" variant="secondary" onPress={pauseSession} style={{ flex: 1 }} />
          )}
          <Button label="Complete Run" onPress={onFinish} style={{ flex: 1 }} />
        </View>

        <SlideToCancelBar onCancel={onCancelRun} />
      </View>
    </SafeAreaView>
  );
}
