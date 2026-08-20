import React, { useRef, useState } from 'react';
import { Alert, Pressable } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, BottomSheet, ListRow } from '../components/core';
import { TAB_BAR_CONTENT_HEIGHT, TAB_BAR_FLOAT_GAP } from './MainTabs';
import type { RootStackParamList } from './types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Layered on top of just the Social tab's own feed screen (see AppShell) —
 * a circular FAB rather than a tab-bar-style affordance, since "new post" is
 * a deliberate action with its own picker sheet, not a background feature
 * like Arnold that belongs as a permanent tab. Opens straight into "post a
 * photo", either captured live or picked from the library.
 */
export function PostFab() {
  const theme = useTheme();
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [sheetOpen, setSheetOpen] = useState(false);
  // BottomSheet's Modal stays natively presented through its own ~200ms
  // close animation — presenting the camera/library picker immediately on
  // tap (while that modal is still dismissing) is a real iOS crash, not just
  // a glitch. So a tap only records *which* picker to open; the actual
  // launch is deferred to BottomSheet's onDismissed, once it's truly gone.
  const pendingPickerRef = useRef<'camera' | 'library' | null>(null);

  const bottomOffset = TAB_BAR_CONTENT_HEIGHT + insets.bottom + TAB_BAR_FLOAT_GAP + theme.spacing.lg;

  const goToCaptionScreen = (photo: { uri: string; contentType: string }) => {
    navigation.navigate('MainTabs', {
      screen: 'CommunityTab',
      params: { screen: 'UploadPhotoPost', params: { mode: 'progress', initialPhoto: photo } },
    });
  };

  const runPicker = async (kind: 'camera' | 'library') => {
    const result =
      kind === 'camera'
        ? await launchCamera({ mediaType: 'photo', quality: 0.8 })
        : await launchImageLibrary({ mediaType: 'photo', quality: 0.8 });
    if (result.didCancel) return;
    if (result.errorCode) {
      Alert.alert(
        kind === 'camera' ? 'Could not open camera' : 'Could not open photo library',
        result.errorMessage ?? 'Please try again.',
      );
      return;
    }
    const asset = result.assets?.[0];
    if (!asset?.uri) return;
    goToCaptionScreen({ uri: asset.uri, contentType: asset.type ?? 'image/jpeg' });
  };

  const onTakePhoto = () => {
    pendingPickerRef.current = 'camera';
    setSheetOpen(false);
  };

  const onChooseFromLibrary = () => {
    pendingPickerRef.current = 'library';
    setSheetOpen(false);
  };

  const onSheetDismissed = () => {
    const kind = pendingPickerRef.current;
    pendingPickerRef.current = null;
    if (kind) runPicker(kind);
  };

  return (
    <>
      <Pressable
        onPress={() => setSheetOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="New post"
        style={[
          {
            position: 'absolute',
            right: theme.spacing.lg,
            bottom: bottomOffset,
            width: 56,
            height: 56,
            borderRadius: theme.radii.pill,
          },
          theme.shadows.lg,
        ]}
      >
        <LinearGradient
          colors={[...theme.gradients.accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            width: 56,
            height: 56,
            borderRadius: theme.radii.pill,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="plus" size="lg" color={theme.colors.text.onAccent} strokeWidth={2.25} />
        </LinearGradient>
      </Pressable>

      <BottomSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onDismissed={onSheetDismissed}
        title="New Post"
      >
        <ListRow title="Take Photo" icon="camera" onPress={onTakePhoto} />
        <ListRow title="Choose from Library" icon="image" onPress={onChooseFromLibrary} />
      </BottomSheet>
    </>
  );
}
