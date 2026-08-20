import React, { useEffect, useState } from 'react';
import { Alert, Image, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Header, Button, LoadingState } from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useProfile, useUpdateProfile, useUploadAvatar } from '../../services/api/queries/profiles';
import type { CommunityStackParamList } from '../../navigation/types';

type Route = RouteProp<CommunityStackParamList, 'AvatarPosition'>;
type Nav = NativeStackNavigationProp<CommunityStackParamList>;

const VIEWPORT_SIZE = 280;

function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

/** Lets the signed-in athlete drag their photo within a circular frame the
 * same size/shape as the real Avatar crop, then saves that position as a
 * normalized 0-1 focal point (Avatar.tsx renders the exact same math from
 * it elsewhere). Reached either right after picking a brand new photo
 * (`pickedUri` set — this screen uploads it once saved) or from "Reposition
 * Photo" on an already-saved one (no `pickedUri` — just moves the existing
 * photo's focal point). */
export function AvatarPositionScreen() {
  const theme = useTheme();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const userId = useAuthStore(state => state.userId);
  const { data: profile } = useProfile(userId);
  const uploadAvatar = useUploadAvatar(userId);
  const updateProfile = useUpdateProfile(userId);
  const [saving, setSaving] = useState(false);

  const isNewPhoto = params?.pickedUri != null;
  const photoUri = params?.pickedUri ?? profile?.avatar_url ?? null;
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    setNatural(null);
    if (!photoUri) return;
    let cancelled = false;
    Image.getSize(
      photoUri,
      (width, height) => {
        if (!cancelled) setNatural({ width, height });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [photoUri]);

  const scale = natural ? Math.max(VIEWPORT_SIZE / natural.width, VIEWPORT_SIZE / natural.height) : 1;
  const imageWidth = natural ? natural.width * scale : VIEWPORT_SIZE;
  const imageHeight = natural ? natural.height * scale : VIEWPORT_SIZE;
  const overflowX = imageWidth - VIEWPORT_SIZE;
  const overflowY = imageHeight - VIEWPORT_SIZE;

  // A freshly picked photo always starts centered — any focal point saved
  // against the *previous* photo has no bearing on this one. Repositioning
  // an existing photo starts from wherever it's already centered.
  const initialFocalX = isNewPhoto ? 0.5 : (profile?.avatar_focal_x ?? 0.5);
  const initialFocalY = isNewPhoto ? 0.5 : (profile?.avatar_focal_y ?? 0.5);

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  useEffect(() => {
    // Re-seeded once the image's natural size (and so its overflow bounds)
    // is actually known — before that, overflow is 0 and there's nothing
    // meaningful to seed yet.
    translateX.value = -overflowX * initialFocalX;
    translateY.value = -overflowY * initialFocalY;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natural]);

  const pan = Gesture.Pan().onChange(event => {
    translateX.value = clamp(translateX.value + event.changeX, -overflowX, 0);
    translateY.value = clamp(translateY.value + event.changeY, -overflowY, 0);
  });

  const imageStyle = useAnimatedStyle(() => ({
    width: imageWidth,
    height: imageHeight,
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }));

  const onSave = async () => {
    if (!photoUri) return;
    const focalX = overflowX > 0 ? clamp(-translateX.value / overflowX, 0, 1) : 0.5;
    const focalY = overflowY > 0 ? clamp(-translateY.value / overflowY, 0, 1) : 0.5;

    setSaving(true);
    try {
      if (params?.pickedUri && params.contentType) {
        await uploadAvatar.mutateAsync({ uri: params.pickedUri, contentType: params.contentType });
      }
      await updateProfile.mutateAsync({ avatar_focal_x: focalX, avatar_focal_y: focalY });
      navigation.goBack();
    } catch (err) {
      Alert.alert('Could not save photo', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }} edges={['top']}>
      <Header
        title="Reposition Photo"
        right={<Button label="Save" size="sm" onPress={onSave} loading={saving} disabled={!natural} />}
      />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.lg, padding: theme.spacing.lg }}>
        {!photoUri ? (
          <Text variant="body" color="secondary">
            No photo to reposition yet.
          </Text>
        ) : (
          <>
            <GestureHandlerRootView style={{ width: VIEWPORT_SIZE, height: VIEWPORT_SIZE }}>
              <View
                style={{
                  width: VIEWPORT_SIZE,
                  height: VIEWPORT_SIZE,
                  borderRadius: VIEWPORT_SIZE / 2,
                  overflow: 'hidden',
                  backgroundColor: theme.colors.bg.surfaceElevated,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {!natural ? (
                  <LoadingState fill={false} />
                ) : (
                  <GestureDetector gesture={pan}>
                    <Animated.Image source={{ uri: photoUri }} style={imageStyle} resizeMode="cover" />
                  </GestureDetector>
                )}
              </View>
            </GestureHandlerRootView>
            <Text variant="caption" color="secondary" style={{ textAlign: 'center' }}>
              Drag the photo to center what shows in your circular profile picture.
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
