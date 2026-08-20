import React, { useRef, useState } from 'react';
import { Alert, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { launchCamera, launchImageLibrary, type Asset } from 'react-native-image-picker';
import { createThumbnail } from 'react-native-create-thumbnail';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Card, Button, IconButton, Icon, BottomSheet, ListRow, BetaBadge, LockedFeatureCard } from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useProfile } from '../../services/api/queries/profiles';
import { useUploadFormCheckPhoto, useAnalyzeFormCheck, useFormCheckUsage } from '../../services/api/queries/formCheck';
import { EdgeFunctionError, type FormCheckResult } from '../../services/api/edgeFunctions';
import type { ProgramsStackParamList, RootStackParamList } from '../../navigation/types';

type Route = RouteProp<ProgramsStackParamList, 'FormCheck'>;
type Nav = NativeStackNavigationProp<ProgramsStackParamList>;
type RootNav = NativeStackNavigationProp<RootStackParamList>;

// Frames are sampled strictly between the start and end of the clip (never
// the endpoints themselves) — the first/last moments of a lifting video are
// disproportionately likely to be racking/unracking the bar rather than the
// rep itself.
const VIDEO_FRAME_COUNT = 5;
// Matches the CameraOptions.durationLimit passed to launchCamera below —
// used here only as a fallback when a picked-from-library asset doesn't
// report its own duration.
const FALLBACK_DURATION_SECONDS = 15;
// launchImageLibrary has no durationLimit option (unlike the camera), so a
// user can pick an existing multi-minute clip straight from their library.
// Decoding frames out of something that long/large is what was crashing the
// app — this rejects oversized picks up front instead of trying anyway.
const MAX_VIDEO_DURATION_SECONDS = 30;
// A single stuck native decode (e.g. a device still fetching an iCloud
// original) shouldn't stall the whole check indefinitely — abandon that
// frame and move on rather than hang.
const FRAME_EXTRACTION_TIMEOUT_MS = 8000;
// Tolerate a couple of bad frames (codec hiccup, timeout, one frame at an
// awkward timestamp) rather than failing the whole check over it — Arnold
// can still read a rep off 3 of 5 frames.
const MIN_SUCCESSFUL_FRAMES = 3;
// Keep in sync with FREE_FORM_CHECKS_PER_MONTH in
// supabase/functions/form-check/index.ts — this is only the client-side
// "X of 3 used" hint and a way to gate the picker up front instead of
// letting an athlete upload straight into a guaranteed 402; the edge
// function is what actually enforces it.
const FREE_FORM_CHECKS_PER_MONTH = 3;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timed out')), ms)),
  ]);
}

type ScreenState =
  | { kind: 'upload' }
  | { kind: 'analyzing'; phase: 'uploading' | 'reviewing'; previewUri: string; isVideo: boolean }
  | { kind: 'results'; result: FormCheckResult; previewUri: string; isVideo: boolean }
  | { kind: 'failed'; message: string; previewUri: string; isVideo: boolean };

function frameTimestampsMs(durationSeconds: number | undefined): number[] {
  const duration = durationSeconds && durationSeconds > 0 ? durationSeconds : FALLBACK_DURATION_SECONDS;
  return Array.from({ length: VIDEO_FRAME_COUNT }, (_, i) => {
    const fraction = (i + 1) / (VIDEO_FRAME_COUNT + 1);
    return Math.round(fraction * duration * 1000);
  });
}

// react-native-image-picker always returns local asset URIs with a
// "file://" scheme. react-native-create-thumbnail's iOS module only strips
// that prefix for http(s) URLs — for anything else it hands the raw string
// straight to `NSURL fileURLWithPath:`, which treats "file://..." as a
// literal (non-absolute) path rather than a URL to unwrap, resolving to a
// file that doesn't exist. That's what surfaced as
// "AVFoundationErrorDomain Code=-11800": the generator was pointed at a
// bogus path, not a real decode failure. Android's module strips the same
// prefix itself, so only iOS needs the workaround here.
function thumbnailSourceUri(uri: string): string {
  return Platform.OS === 'ios' ? uri.replace(/^file:\/\//, '') : uri;
}

export function FormCheckScreen() {
  const theme = useTheme();
  const navigation = useNavigation<Nav>();
  const rootNavigation = useNavigation<RootNav>();
  const { params } = useRoute<Route>();
  const userId = useAuthStore(state => state.userId);
  const queryClient = useQueryClient();

  const { data: profile } = useProfile(userId);
  const isPremium = profile?.is_premium ?? false;
  const { data: checksUsedThisMonth = 0 } = useFormCheckUsage(userId);
  const atFreeLimit = !isPremium && checksUsedThisMonth >= FREE_FORM_CHECKS_PER_MONTH;

  const uploadPhoto = useUploadFormCheckPhoto(userId);
  const analyze = useAnalyzeFormCheck();

  const [state, setState] = useState<ScreenState>({ kind: 'upload' });
  const [pickerMediaType, setPickerMediaType] = useState<'photo' | 'video' | null>(null);
  const [pickerSheetOpen, setPickerSheetOpen] = useState(false);
  // BottomSheet's Modal stays natively presented through its own close
  // animation — presenting the camera/library picker immediately on tap
  // (while that modal is still dismissing) silently drops the presentation
  // on iOS instead of opening it, and can crash outright once the timing
  // lines up wrong (same issue ChatScreen's attach sheet documents). So a
  // row tap only records which source to open; the actual launch is
  // deferred to BottomSheet's onDismissed, once it's truly gone.
  const pendingSourceRef = useRef<'camera' | 'library' | null>(null);

  const runAnalysis = async (asset: Asset, mediaType: 'photo' | 'video') => {
    if (!asset.uri) return;
    const previewUri = asset.uri;
    const isVideo = mediaType === 'video';

    if (isVideo && asset.duration && asset.duration > MAX_VIDEO_DURATION_SECONDS) {
      Alert.alert('Clip too long', `Please choose a video under ${MAX_VIDEO_DURATION_SECONDS} seconds.`);
      return;
    }

    setState({ kind: 'analyzing', phase: 'uploading', previewUri, isVideo });

    try {
      // Extracted one frame at a time rather than via Promise.all — firing
      // several concurrent native AVAssetImageGenerator decodes against the
      // same video is what was spiking memory and crashing the app on
      // longer/larger clips. Each frame gets its own timeout + failure
      // tolerance so one bad/slow frame can't stall or sink the whole check.
      const frames: Array<{ uri: string; contentType: string }> = [];
      if (isVideo) {
        for (const timeStamp of frameTimestampsMs(asset.duration)) {
          try {
            const thumb = await withTimeout(
              createThumbnail({ url: thumbnailSourceUri(asset.uri!), timeStamp, format: 'jpeg' }),
              FRAME_EXTRACTION_TIMEOUT_MS,
            );
            frames.push({ uri: thumb.path, contentType: thumb.mime });
          } catch (frameErr) {
            console.error('[FormCheck] frame extraction failed', frameErr);
          }
        }
        if (frames.length < MIN_SUCCESSFUL_FRAMES) {
          throw new Error(`Only extracted ${frames.length}/${VIDEO_FRAME_COUNT} frames`);
        }
      } else {
        frames.push({ uri: asset.uri, contentType: asset.type ?? 'image/jpeg' });
      }

      // Uploads are network I/O, not native memory-heavy decodes, so unlike
      // frame extraction above there's no crash risk in running them
      // concurrently — and doing so meaningfully cuts this phase's latency.
      const photoPaths = await Promise.all(frames.map(frame => uploadPhoto.mutateAsync(frame)));

      setState({ kind: 'analyzing', phase: 'reviewing', previewUri, isVideo });

      const result = await analyze.mutateAsync({
        exercise_id: params.exerciseId,
        exercise_name: params.exerciseName,
        photo_paths: photoPaths,
      });
      setState({ kind: 'results', result, previewUri, isVideo });
      queryClient.invalidateQueries({ queryKey: ['form_check_usage', userId] });
    } catch (err) {
      if (err instanceof EdgeFunctionError && err.code === 'free_limit_reached') {
        // Rare in practice now that openPicker gates on atFreeLimit up
        // front — this only fires if the count was stale (e.g. a check
        // completed from another device moments earlier). Refresh the
        // count so the upload screen's banner/gate reflects reality instead
        // of quietly resetting with no visible explanation.
        queryClient.invalidateQueries({ queryKey: ['form_check_usage', userId] });
        setState({ kind: 'upload' });
        rootNavigation.navigate('Paywall', { trigger: 'form_check' });
        return;
      }
      // Raw error messages (native crash domains, HTTP bodies, etc.) are
      // never fit for display — log the real one for debugging and show a
      // fixed, friendly message regardless of what actually failed.
      console.error('[FormCheck] analysis failed', err);
      setState({
        kind: 'failed',
        message: `We couldn't review that ${isVideo ? 'clip' : 'photo'}. Please try again.`,
        previewUri,
        isVideo,
      });
    }
  };

  const openPicker = (mediaType: 'photo' | 'video') => {
    if (atFreeLimit) {
      rootNavigation.navigate('Paywall', { trigger: 'form_check' });
      return;
    }
    setPickerMediaType(mediaType);
    setPickerSheetOpen(true);
  };

  const onChooseSource = (source: 'camera' | 'library') => {
    pendingSourceRef.current = source;
    setPickerSheetOpen(false);
  };

  const onPickerSheetDismissed = async () => {
    const source = pendingSourceRef.current;
    pendingSourceRef.current = null;
    const mediaType = pickerMediaType;
    setPickerMediaType(null);
    if (!source || !mediaType) return;

    try {
      // durationLimit only exists on CameraOptions (it caps a recording in
      // progress) — ImageLibraryOptions has no equivalent, since there's
      // nothing to cap when picking an already-recorded video. Building the
      // options per-source rather than sharing one object keeps each call
      // honest about what it actually accepts.
      const result =
        source === 'camera'
          ? await launchCamera(
              mediaType === 'video'
                ? { mediaType: 'video', durationLimit: FALLBACK_DURATION_SECONDS }
                : { mediaType: 'photo', quality: 0.8, maxWidth: 1568, maxHeight: 1568 },
            )
          : await launchImageLibrary(
              mediaType === 'video' ? { mediaType: 'video' } : { mediaType: 'photo', quality: 0.8, maxWidth: 1568, maxHeight: 1568 },
            );
      if (result.didCancel) return;
      if (result.errorCode) {
        Alert.alert(
          source === 'camera' ? 'Could not open camera' : 'Could not open photo library',
          result.errorMessage ?? 'Please try again.',
        );
        return;
      }
      const asset = result.assets?.[0];
      if (!asset?.uri) return;
      runAnalysis(asset, mediaType);
    } catch (err) {
      // launchCamera/launchImageLibrary normally resolve with
      // didCancel/errorCode rather than throwing, but a thrown/rejected
      // promise here (e.g. a native module error) would otherwise vanish as
      // a silent unhandled rejection — this screen would just sit on the
      // upload state with no visible feedback at all.
      Alert.alert(
        source === 'camera' ? 'Could not open camera' : 'Could not open photo library',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  };

  const reset = () => setState({ kind: 'upload' });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.sm,
        }}
      >
        <IconButton
          name="x"
          variant="ghost"
          accessibilityLabel="Close Form Check"
          onPress={() => navigation.goBack()}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text variant="title">Form Check</Text>
          <BetaBadge />
        </View>
        <View style={{ width: theme.sizes.iconButton }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingTop: 0, gap: theme.spacing.lg, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            alignSelf: 'flex-start',
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.xs,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.xs,
            borderRadius: theme.radii.pill,
            backgroundColor: theme.colors.accent.subtle,
          }}
        >
          <Icon name="dumbbell" size="sm" color={theme.colors.accent.purple} />
          <Text variant="caption" style={{ color: theme.colors.accent.purple, fontWeight: '700' }}>
            {params.exerciseName}
          </Text>
        </View>

        {state.kind === 'upload' ? (
          <>
            <Card variant="flat" style={{ alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.xxl }}>
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: theme.radii.pill,
                  backgroundColor: theme.colors.accent.subtle,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="video" size="lg" color={theme.colors.accent.purple} />
              </View>
              <Text variant="subtitle">Add a video or photo</Text>
              <Text variant="caption" color="secondary" style={{ textAlign: 'center', maxWidth: 220 }}>
                A 10-15 sec clip from the side captures your whole rep
              </Text>
            </Card>

            {atFreeLimit ? (
              <LockedFeatureCard
                title="You've used your free Form Checks this month"
                description={`Everyone gets ${FREE_FORM_CHECKS_PER_MONTH} free Form Checks a month with Arnold. Upgrade to SetSocial Pro for unlimited checks.`}
                onUpgrade={() => rootNavigation.navigate('Paywall', { trigger: 'form_check' })}
              />
            ) : (
              <View style={{ gap: theme.spacing.sm }}>
                <Button label="Record or Upload Video" icon="video" onPress={() => openPicker('video')} />
                <Button label="Take a Photo Instead" icon="camera" variant="secondary" onPress={() => openPicker('photo')} />
                {!isPremium ? (
                  <Text variant="caption" color="tertiary" style={{ textAlign: 'center' }}>
                    {checksUsedThisMonth} of {FREE_FORM_CHECKS_PER_MONTH} free Form Checks used this month
                  </Text>
                ) : null}
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <Icon name="eye" size="sm" color={theme.colors.accent.blue} />
              <Text variant="caption" color="secondary" style={{ flex: 1 }}>
                Best angle: side-on, full body in frame, bar visible.
              </Text>
            </View>
          </>
        ) : null}

        {state.kind === 'analyzing' ? (
          <View style={{ alignItems: 'center', gap: theme.spacing.md, paddingTop: theme.spacing.xl }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: theme.radii.pill,
                backgroundColor: theme.colors.accent.subtle,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={state.isVideo ? 'video' : 'camera'} size="lg" color={theme.colors.accent.purple} />
            </View>
            {state.phase === 'uploading' ? (
              <>
                <Text variant="subtitle">Uploading your {state.isVideo ? 'video' : 'photo'}…</Text>
                <Text variant="caption" color="secondary">
                  Hang tight, almost there
                </Text>
              </>
            ) : (
              <>
                <View style={{ flexDirection: 'row', gap: theme.spacing.xs, alignItems: 'center' }}>
                  <Icon name="check" size="sm" color={theme.colors.accent.primary} />
                  <Text variant="caption" color="secondary">
                    {state.isVideo ? 'Video' : 'Photo'} uploaded
                  </Text>
                </View>
                <Text variant="subtitle">Arnold is reviewing your form…</Text>
                <Text variant="caption" color="secondary">
                  Usually takes 5-10 seconds
                </Text>
              </>
            )}
          </View>
        ) : null}

        {state.kind === 'results' ? (
          <>
            <Card
              variant="subtle"
              style={{
                borderLeftWidth: 3,
                borderLeftColor: theme.colors.semantic.warning,
                backgroundColor: `${theme.colors.semantic.warning}1A`,
              }}
            >
              <Text variant="body" style={{ fontWeight: '700' }}>
                {state.result.summary}
              </Text>
              <Text variant="caption" color="secondary">
                Confidence: {state.result.confidence}
              </Text>
            </Card>

            <View style={{ borderRadius: theme.radii.lg, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border.default }}>
              {state.result.cues.map((cue, index) => (
                <View
                  key={`${cue.label}-${index}`}
                  style={{
                    flexDirection: 'row',
                    gap: theme.spacing.sm,
                    padding: theme.spacing.md,
                    backgroundColor: theme.colors.bg.surface,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: theme.colors.border.subtle,
                  }}
                >
                  <Icon
                    name={cue.status === 'good' ? 'circleCheck' : 'circleAlert'}
                    size="sm"
                    color={cue.status === 'good' ? theme.colors.accent.primary : theme.colors.semantic.warning}
                  />
                  <View style={{ flex: 1 }}>
                    <Text variant="body" style={{ fontWeight: '700' }}>
                      {cue.label}
                    </Text>
                    <Text variant="caption" color="secondary">
                      {cue.note}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            {state.result.tips.length > 0 ? (
              <Card variant="subtle" style={{ backgroundColor: theme.colors.accent.subtle, gap: theme.spacing.xs }}>
                <Text variant="label" style={{ color: theme.colors.accent.purple }}>
                  TRY NEXT TIME
                </Text>
                {state.result.tips.map((tip, index) => (
                  <View key={index} style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
                    <Icon name="chevronRight" size="sm" color={theme.colors.accent.purple} />
                    <Text variant="body" style={{ flex: 1 }}>
                      {tip}
                    </Text>
                  </View>
                ))}
              </Card>
            ) : null}

            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button
                  label="Ask Arnold"
                  icon="messageCircle"
                  variant="secondary"
                  onPress={() => rootNavigation.navigate('Chat', {})}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Redo Check" icon="repeat" variant="secondary" onPress={reset} />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: theme.spacing.xs, alignItems: 'center' }}>
              <Icon name="check" size="sm" color={theme.colors.accent.primary} />
              <Text variant="caption" color="tertiary">
                {state.isVideo ? 'Video' : 'Photo'} deleted. Only this summary was saved to your log.
              </Text>
            </View>
          </>
        ) : null}

        {state.kind === 'failed' ? (
          <View style={{ alignItems: 'center', gap: theme.spacing.md, paddingTop: theme.spacing.xl }}>
            <Icon name="circleAlert" size="lg" color={theme.colors.semantic.danger} />
            <Text variant="subtitle" style={{ textAlign: 'center' }}>
              {state.message}
            </Text>
            <Button label="Try Again" onPress={reset} />
          </View>
        ) : null}
      </ScrollView>

      {state.kind === 'upload' ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border.default,
          }}
        >
          <Icon name="lock" size="sm" color={theme.colors.accent.primary} />
          <Text variant="caption" color="tertiary" style={{ flex: 1 }}>
            Not stored. Used only to generate this feedback, then deleted.
          </Text>
        </View>
      ) : null}

      <BottomSheet
        visible={pickerSheetOpen}
        onClose={() => setPickerSheetOpen(false)}
        onDismissed={onPickerSheetDismissed}
        title="Add a photo or video"
      >
        <View style={{ gap: theme.spacing.xs }}>
          <ListRow title="Use Camera" icon="camera" onPress={() => onChooseSource('camera')} />
          <ListRow title="Choose from Library" icon="image" onPress={() => onChooseSource('library')} />
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
}
