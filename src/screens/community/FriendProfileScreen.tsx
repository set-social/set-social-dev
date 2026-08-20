import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { launchImageLibrary } from 'react-native-image-picker';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import {
  Text,
  Header,
  LoadingState,
  FriendRequestButton,
  IconButton,
  BottomSheet,
  ListRow,
  PostThumbnail,
  Avatar,
  Icon,
  TextField,
  Button,
  EmptyState,
  ProBadge,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import {
  useFriendProfile,
  useFriendRelationships,
  resolveFriendRequestState,
  useSendFriendRequest,
  useAcceptFriendRequest,
  useDeclineFriendRequest,
  useRemoveFriendRequest,
  useIsBlocked,
  useBlockUser,
  useFriendCount,
} from '../../services/api/queries/community';
import { useStartConversation } from '../../services/api/queries/directMessages';
import { useUpdateProfile } from '../../services/api/queries/profiles';
import {
  useUserPosts,
  useSignedPhotoUrls,
  postPhotoPaths,
} from '../../services/api/queries/posts';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import { formatVolume, unitLabel } from '../../utils/units';
import { getErrorMessage } from '../../utils/errors';
import type { CommunityStackParamList } from '../../navigation/types';

type Route = RouteProp<CommunityStackParamList, 'FriendProfile'>;
type Nav = NativeStackNavigationProp<CommunityStackParamList>;

const BIO_MAX_LENGTH = 150;

const PROFILE_GLOW_HEIGHT = 260;

// friend_requests mutations fire-and-forget via .mutate() — without this,
// a failure (e.g. a blocked user, a network drop) left the button just
// sitting there with no visible change, indistinguishable from "the button
// doesn't work" (see 0045_friend_request_resend.sql for the bug this
// surfaced).
const onFriendActionError = (err: unknown) =>
  Alert.alert(
    'Something went wrong',
    getErrorMessage(err, 'Please try again.'),
  );

export function FriendProfileScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const { width } = useWindowDimensions();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const userId = useAuthStore(state => state.userId);
  const unitPref = useUnitPreference();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bioSheetOpen, setBioSheetOpen] = useState(false);
  const [bioDraft, setBioDraft] = useState('');
  const [addPostSheetOpen, setAddPostSheetOpen] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);

  const {
    data: profile,
    isLoading,
    refetch: refetchProfile,
  } = useFriendProfile(params.userId);
  const { data: friendCount } = useFriendCount(params.userId);
  const { data: relationships } = useFriendRelationships(userId);
  const { data: isBlocked, isLoading: blockedLoading } = useIsBlocked(
    userId,
    params.userId,
  );
  const sendRequest = useSendFriendRequest(userId);
  const acceptRequest = useAcceptFriendRequest(userId);
  const declineRequest = useDeclineFriendRequest(userId);
  const removeRequest = useRemoveFriendRequest(userId);
  const blockUser = useBlockUser(userId);
  const updateProfile = useUpdateProfile(userId);
  const startConversation = useStartConversation();

  const { data: posts, refetch: refetchPosts } = useUserPosts(params.userId);
  const postPaths = useMemo(
    () => (posts ?? []).flatMap(postPhotoPaths),
    [posts],
  );
  const { data: signedUrls, refetch: refetchSignedUrls } =
    useSignedPhotoUrls(postPaths);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetchProfile(),
        refetchPosts(),
        refetchSignedUrls(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchProfile, refetchPosts, refetchSignedUrls]);

  const isSelf = params.userId === userId;
  const { state, requestId } = resolveFriendRequestState(
    relationships,
    params.userId,
  );
  const actionLoading =
    sendRequest.isPending ||
    acceptRequest.isPending ||
    declineRequest.isPending ||
    removeRequest.isPending;

  // Uploading (and saving where the photo is centered) happens on
  // AvatarPosition, not here — picking is the only native-picker step left
  // in this screen.
  const pickAndPositionPhoto = async () => {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
    });
    if (result.didCancel) return;
    if (result.errorCode) {
      Alert.alert(
        'Could not open photo library',
        result.errorMessage ?? 'Please try again.',
      );
      return;
    }
    const asset = result.assets?.[0];
    if (!asset?.uri) return;
    navigation.navigate('AvatarPosition', {
      pickedUri: asset.uri,
      contentType: asset.type ?? 'image/jpeg',
    });
  };

  // A first-ever photo has nothing to reposition yet — skip straight to
  // picking. Once a photo exists, tapping the avatar offers a choice
  // instead of jumping straight into the picker every time.
  const onAvatarPress = () => {
    if (!profile?.avatar_url) {
      pickAndPositionPhoto();
      return;
    }
    setAvatarMenuOpen(true);
  };

  const onSaveBio = async () => {
    try {
      await updateProfile.mutateAsync({ bio: bioDraft.trim() || null });
      setBioSheetOpen(false);
    } catch (err) {
      Alert.alert(
        'Could not save bio',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  };

  const goToUploadPost = (mode: 'progress' | 'before_after') => {
    setAddPostSheetOpen(false);
    navigation.navigate('UploadPhotoPost', { mode });
  };

  const onMessage = async () => {
    if (!userId) return;
    try {
      const conversation = await startConversation.mutateAsync({
        userId,
        otherUserId: params.userId,
      });
      navigation.navigate('Conversation', { conversationId: conversation.id });
    } catch (err) {
      Alert.alert(
        'Could not start conversation',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  };

  const confirmBlock = () => {
    setMenuOpen(false);
    Alert.alert(
      `Block ${profile?.display_name ?? 'this athlete'}?`,
      "They won't be able to see your profile or activity, and you won't see theirs.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => blockUser.mutate(params.userId),
        },
      ],
    );
  };

  if (!isSelf && !blockedLoading && isBlocked) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: theme.colors.bg.base }}
        edges={['top']}
      >
        <Header title="Profile" />
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: theme.spacing.xl,
          }}
        >
          <Text
            variant="body"
            color="secondary"
            style={{ textAlign: 'center' }}
          >
            This profile is unavailable.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg.base }}
      edges={['top']}
    >
      {/* Ambient glow — a full-width wash anchored to the true top of the
          screen (behind the Header too, which has no background of its own)
          rather than a small box inset by the scroll content's own padding.
          Percentage-based cx/cy/r (the default objectBoundingBox units)
          scale with the actual device width, instead of the old literal
          pixel centers/radii that were sized for a much narrower box and so
          clipped hard at its edges — which is what read as "squared off". */}
      <Svg
        style={{ position: 'absolute', top: 0, left: 0 }}
        width={width}
        height={PROFILE_GLOW_HEIGHT}
        pointerEvents="none"
      >
        <Defs>
          <RadialGradient id="profileGlowGreen" cx="20%" cy="0%" r="75%">
            <Stop
              offset="0"
              stopColor={theme.colors.accent.primary}
              stopOpacity={0.22}
            />
            <Stop
              offset="1"
              stopColor={theme.colors.accent.primary}
              stopOpacity={0}
            />
          </RadialGradient>
          <RadialGradient id="profileGlowPurple" cx="80%" cy="0%" r="75%">
            <Stop
              offset="0"
              stopColor={theme.colors.accent.purple}
              stopOpacity={0.18}
            />
            <Stop
              offset="1"
              stopColor={theme.colors.accent.purple}
              stopOpacity={0}
            />
          </RadialGradient>
        </Defs>
        <Rect
          x="0"
          y="0"
          width={width}
          height={PROFILE_GLOW_HEIGHT}
          fill="url(#profileGlowGreen)"
        />
        <Rect
          x="0"
          y="0"
          width={width}
          height={PROFILE_GLOW_HEIGHT}
          fill="url(#profileGlowPurple)"
        />
      </Svg>

      <Header
        title="Profile"
        right={
          !isSelf ? (
            <IconButton
              name="moreVertical"
              variant="ghost"
              accessibilityLabel="Profile options"
              onPress={() => setMenuOpen(true)}
            />
          ) : undefined
        }
      />

      {isLoading ? (
        <LoadingState />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            padding: theme.spacing.lg,
            paddingTop: 0,
            paddingBottom: theme.spacing.lg + tabBarHeight,
            gap: theme.spacing.lg,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.accent.primary}
            />
          }
        >
          <View>
            <View
              style={{ paddingTop: theme.spacing.md, alignItems: 'flex-start' }}
            >
              <View>
                <Avatar
                  uri={profile?.avatar_url}
                  focalX={profile?.avatar_focal_x}
                  focalY={profile?.avatar_focal_y}
                  size={72}
                  onPress={isSelf ? onAvatarPress : undefined}
                  accessibilityLabel="Profile photo"
                />
                {isSelf ? (
                  <View
                    style={{
                      position: 'absolute',
                      right: -2,
                      bottom: -2,
                      width: 26,
                      height: 26,
                      borderRadius: theme.radii.pill,
                      backgroundColor: theme.colors.accent.primary,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 2,
                      borderColor: theme.colors.bg.base,
                    }}
                  >
                    <Icon
                      name="camera"
                      size={14}
                      color={theme.colors.text.onAccent}
                    />
                  </View>
                ) : null}
              </View>
            </View>
            <View style={{ marginTop: theme.spacing.sm }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.xxs,
                }}
              >
                <Text variant="title">
                  {profile?.display_name ?? 'Athlete'}
                </Text>
                {profile?.is_premium ? <ProBadge /> : null}
                {profile?.is_private ? (
                  <View accessible accessibilityLabel="Private account">
                    <Icon
                      name="lock"
                      size="sm"
                      color={theme.colors.text.tertiary}
                    />
                  </View>
                ) : null}
              </View>
              {profile?.handle ? (
                <Text variant="body" color="secondary">
                  @{profile.handle}
                </Text>
              ) : null}
            </View>
          </View>

          {isSelf ? (
            <Pressable
              onPress={() => {
                setBioDraft(profile?.bio ?? '');
                setBioSheetOpen(true);
              }}
            >
              <Text
                variant="body"
                color={profile?.bio ? 'primary' : 'tertiary'}
              >
                {profile?.bio ?? 'Add a bio'}
              </Text>
            </Pressable>
          ) : profile?.bio ? (
            <Text variant="body">{profile.bio}</Text>
          ) : null}

          {!isSelf && profile?.hide_stats_from_friends ? (
            <View style={{ gap: theme.spacing.xs }}>
              <Pressable
                onPress={() =>
                  navigation.navigate('FriendsList', {
                    userId: params.userId,
                    title: 'Friends',
                  })
                }
              >
                <View>
                  <Text variant="subtitle">{friendCount ?? 0}</Text>
                  <Text variant="label" color="secondary">
                    Friends
                  </Text>
                </View>
              </Pressable>
              <Text variant="caption" color="tertiary">
                This athlete has made their stats private.
              </Text>
            </View>
          ) : (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.lg,
              }}
            >
              <View>
                <Text variant="subtitle">{`${formatVolume(
                  profile?.volumeThisMonth ?? 0,
                  unitPref,
                )} ${unitLabel(unitPref)}`}</Text>
                <Text variant="label" color="secondary">
                  Volume
                </Text>
              </View>
              <View
                style={{
                  width: 1,
                  height: 28,
                  backgroundColor: theme.colors.border.default,
                }}
              />
              <View>
                <Text variant="subtitle">
                  {profile?.workoutsThisMonth ?? 0}
                </Text>
                <Text variant="label" color="secondary">
                  Workouts
                </Text>
              </View>
              <View
                style={{
                  width: 1,
                  height: 28,
                  backgroundColor: theme.colors.border.default,
                }}
              />
              <Pressable
                onPress={() =>
                  navigation.navigate('FriendsList', {
                    userId: params.userId,
                    title: 'Friends',
                  })
                }
              >
                <View>
                  <Text variant="subtitle">{friendCount ?? 0}</Text>
                  <Text variant="label" color="secondary">
                    Friends
                  </Text>
                </View>
              </Pressable>
            </View>
          )}

          {!isSelf ? (
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <FriendRequestButton
                  state={state}
                  displayName={profile?.display_name ?? 'this athlete'}
                  size="md"
                  loading={actionLoading}
                  onSend={() =>
                    sendRequest.mutate(params.userId, {
                      onError: onFriendActionError,
                    })
                  }
                  onAccept={() =>
                    requestId &&
                    acceptRequest.mutate(requestId, {
                      onError: onFriendActionError,
                    })
                  }
                  onDecline={() =>
                    requestId &&
                    declineRequest.mutate(requestId, {
                      onError: onFriendActionError,
                    })
                  }
                  onRemove={() =>
                    requestId &&
                    removeRequest.mutate(requestId, {
                      onError: onFriendActionError,
                    })
                  }
                />
              </View>
              <Button
                label="Message"
                variant="secondary"
                onPress={onMessage}
                loading={startConversation.isPending}
              />
            </View>
          ) : null}

          {isSelf || (posts != null && posts.length > 0) ? (
            <View style={{ gap: theme.spacing.sm }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Text variant="label" color="secondary">
                  POSTS
                </Text>
                {isSelf ? (
                  <IconButton
                    name="plus"
                    variant="ghost"
                    size={28}
                    accessibilityLabel="Post a photo"
                    onPress={() => setAddPostSheetOpen(true)}
                  />
                ) : null}
              </View>
              {posts != null && posts.length > 0 ? (
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: theme.spacing.sm,
                  }}
                >
                  {posts.map(post => (
                    <View
                      key={post.id}
                      style={{ width: '48%', ...theme.shadows.sm }}
                    >
                      <PostThumbnail
                        post={post}
                        photoUrl={
                          post.photo_path
                            ? signedUrls?.[post.photo_path]
                            : undefined
                        }
                        beforeUrl={
                          post.before_photo_path
                            ? signedUrls?.[post.before_photo_path]
                            : undefined
                        }
                        afterUrl={
                          post.after_photo_path
                            ? signedUrls?.[post.after_photo_path]
                            : undefined
                        }
                        aspectRatio={1}
                        radius={theme.radii.md}
                        onPress={() =>
                          navigation.navigate('PostDetail', { postId: post.id })
                        }
                      />
                    </View>
                  ))}
                </View>
              ) : isSelf ? (
                <EmptyState
                  icon="camera"
                  title="No posts yet"
                  description="Share a progress photo or a before & after with your friends."
                  actionLabel="Post a Photo"
                  onAction={() => setAddPostSheetOpen(true)}
                />
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      )}

      <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <ListRow
          title={`Block ${profile?.display_name ?? 'athlete'}`}
          icon="circleAlert"
          onPress={confirmBlock}
        />
      </BottomSheet>

      <BottomSheet
        visible={avatarMenuOpen}
        onClose={() => setAvatarMenuOpen(false)}
        title="Profile Photo"
      >
        <View style={{ gap: theme.spacing.xs }}>
          <ListRow
            title="Choose New Photo"
            icon="camera"
            onPress={() => {
              setAvatarMenuOpen(false);
              pickAndPositionPhoto();
            }}
          />
          <ListRow
            title="Reposition Photo"
            icon="target"
            onPress={() => {
              setAvatarMenuOpen(false);
              navigation.navigate('AvatarPosition');
            }}
          />
        </View>
      </BottomSheet>

      <BottomSheet
        visible={bioSheetOpen}
        onClose={() => setBioSheetOpen(false)}
        title="Edit Bio"
      >
        <View style={{ gap: theme.spacing.lg }}>
          <TextField
            value={bioDraft}
            onChangeText={setBioDraft}
            placeholder="Tell friends about yourself"
            multiline
            maxLength={BIO_MAX_LENGTH}
          />
          <Button
            label="Save"
            onPress={onSaveBio}
            loading={updateProfile.isPending}
          />
        </View>
      </BottomSheet>

      <BottomSheet
        visible={addPostSheetOpen}
        onClose={() => setAddPostSheetOpen(false)}
      >
        <ListRow
          title="Post Progress Photo"
          icon="camera"
          onPress={() => goToUploadPost('progress')}
        />
        <ListRow
          title="Post Before & After"
          icon="camera"
          onPress={() => goToUploadPost('before_after')}
        />
      </BottomSheet>
    </SafeAreaView>
  );
}
