import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { formatDistanceToNow } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import {
  Text,
  Avatar,
  Header,
  IconButton,
  LoadingState,
  EmptyState,
  VisibilityBadge,
  VisibilitySelector,
  TextField,
  Button,
  BottomSheet,
  ListRow,
  LikeBurst,
  ReportBlockSheet,
  KeyboardAvoider,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import {
  usePost,
  useSignedPhotoUrls,
  postPhotoPaths,
  useUpdatePost,
  useDeletePost,
} from '../../services/api/queries/posts';
import { useFriendProfile } from '../../services/api/queries/community';
import {
  useComments,
  useCreateComment,
  useDeleteComment,
  type Comment,
} from '../../services/api/queries/comments';
import { useLikes, useToggleLike } from '../../services/api/queries/likes';
import { CommentRow } from './CommentRow';
import type {
  CommunityStackParamList,
  ProfileStackParamList,
} from '../../navigation/types';
import type { PostVisibility } from '../../types/database';

type Route = RouteProp<
  CommunityStackParamList | ProfileStackParamList,
  'PostDetail'
>;
type Nav = NativeStackNavigationProp<
  CommunityStackParamList | ProfileStackParamList
>;

export function PostDetailScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const userId = useAuthStore(state => state.userId);

  const {
    data: post,
    isLoading,
    refetch: refetchPost,
  } = usePost(params.postId);
  const { data: owner } = useFriendProfile(post?.user_id ?? null);
  const updatePost = useUpdatePost(userId);
  const deletePost = useDeletePost(userId);

  const { data: comments, refetch: refetchComments } = useComments(
    params.postId,
  );
  const createComment = useCreateComment(params.postId, userId);
  const deleteComment = useDeleteComment(params.postId);
  const [commentDraft, setCommentDraft] = useState('');

  const { data: likes, refetch: refetchLikes } = useLikes(
    params.postId,
    userId,
  );
  const toggleLike = useToggleLike(params.postId, userId);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetchPost(), refetchComments(), refetchLikes()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchPost, refetchComments, refetchLikes]);
  const likedByMe = likes?.likedByMe ?? false;
  const [likeBurstTrigger, setLikeBurstTrigger] = useState(0);

  const photoPaths = useMemo(() => (post ? postPhotoPaths(post) : []), [post]);
  const { data: signedUrls } = useSignedPhotoUrls(photoPaths);

  const [menuOpen, setMenuOpen] = useState(false);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [reportingComment, setReportingComment] = useState<Comment | null>(
    null,
  );
  const [editOpen, setEditOpen] = useState(false);
  const [editCaption, setEditCaption] = useState('');
  const [editVisibility, setEditVisibility] =
    useState<PostVisibility>('friends');
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    if (!post) return;
    setEditCaption(post.caption ?? '');
    setEditVisibility(post.visibility);
  }, [post]);

  const isSelf = post != null && post.user_id === userId;

  // Shared by the post owner row and every comment row below. This screen is
  // reachable from both CommunityStack and ProfileStack (viewing one of your
  // own posts from the Profile tab), and FriendProfile is deliberately
  // registered in both (see ProfileStack.tsx's own comment) so this cast is
  // safe either way — both stacks share the same 'FriendProfile' route
  // shape, it just isn't statically knowable which one this screen is
  // currently mounted under.
  const goToProfile = useCallback(
    (targetUserId: string) => {
      if (targetUserId === userId) return;
      (
        navigation as NativeStackNavigationProp<CommunityStackParamList>
      ).navigate('FriendProfile', {
        userId: targetUserId,
      });
    },
    [navigation, userId],
  );

  const goToOwnerProfile = () => {
    if (!post) return;
    goToProfile(post.user_id);
  };

  const onSaveEdit = async () => {
    if (!post) return;
    setEditError(null);
    try {
      await updatePost.mutateAsync({
        post,
        caption: editCaption.trim() || null,
        visibility: editVisibility,
      });
      setEditOpen(false);
    } catch (err) {
      setEditError(
        err instanceof Error
          ? err.message
          : 'Could not save changes. Try again.',
      );
    }
  };

  const onPostComment = async () => {
    const body = commentDraft.trim();
    if (!body) return;
    try {
      await createComment.mutateAsync(body);
      setCommentDraft('');
    } catch (err) {
      Alert.alert(
        'Could not post comment',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  };

  // Double-tap always plays the animation, but — matching Instagram — only
  // actually likes when not already liked; it never unlikes.
  const onDoubleTapPhoto = () => {
    setLikeBurstTrigger(t => t + 1);
    if (!likedByMe) {
      toggleLike.mutate(false);
    }
  };

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      runOnJS(onDoubleTapPhoto)();
    });

  const onDeleteComment = useCallback(
    (commentId: string) => {
      Alert.alert('Delete comment?', "This can't be undone.", [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteComment.mutate(commentId),
        },
      ]);
    },
    [deleteComment],
  );

  const renderComment = useCallback(
    ({ item: comment }: ListRenderItemInfo<Comment>) => (
      <CommentRow
        comment={comment}
        canDelete={comment.user_id === userId || isSelf}
        canReport={comment.user_id !== userId}
        onPressAuthor={goToProfile}
        onDelete={onDeleteComment}
        onReport={setReportingComment}
      />
    ),
    [userId, isSelf, goToProfile, onDeleteComment],
  );

  const onDelete = () => {
    if (!post) return;
    setMenuOpen(false);
    Alert.alert('Delete post?', "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deletePost.mutateAsync(post);
            navigation.goBack();
          } catch (err) {
            Alert.alert(
              'Could not delete post',
              err instanceof Error ? err.message : 'Please try again.',
            );
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg.base }}
      edges={['top']}
    >
      <Header
        title="Post"
        right={
          post ? (
            <IconButton
              name="moreVertical"
              variant="ghost"
              accessibilityLabel="Post options"
              onPress={() =>
                isSelf ? setMenuOpen(true) : setModerationOpen(true)
              }
            />
          ) : undefined
        }
      />
      {isLoading ? (
        <LoadingState />
      ) : !post ? (
        <EmptyState
          icon="circleAlert"
          title="Post unavailable"
          description="This post may have been removed."
        />
      ) : (
        <KeyboardAvoider>
          <FlatList
            data={comments ?? []}
            keyExtractor={comment => comment.id}
            renderItem={renderComment}
            ItemSeparatorComponent={() => (
              <View style={{ height: theme.spacing.md }} />
            )}
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{
              padding: theme.spacing.lg,
              paddingTop: 0,
              gap: theme.spacing.lg,
            }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.colors.accent.primary}
              />
            }
            ListHeaderComponent={
              <View style={{ gap: theme.spacing.lg }}>
                <Pressable
                  onPress={goToOwnerProfile}
                  disabled={isSelf}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                  }}
                >
                  <Avatar
                    uri={owner?.avatar_url}
                    focalX={owner?.avatar_focal_x}
                    focalY={owner?.avatar_focal_y}
                    size={40}
                  />
                  <View style={{ flex: 1 }}>
                    <Text variant="subtitle">
                      {isSelf ? 'You' : owner?.display_name ?? 'Athlete'}
                    </Text>
                    <Text variant="caption" color="secondary">
                      {formatDistanceToNow(new Date(post.created_at), {
                        addSuffix: true,
                      })}
                    </Text>
                  </View>
                  {isSelf ? <VisibilityBadge visibility={post.visibility} /> : null}
                </Pressable>

                <GestureDetector gesture={doubleTap}>
                  <View style={{ position: 'relative' }}>
                    {post.post_type === 'progress_photo' ? (
                      <View
                        style={{
                          width: '100%',
                          aspectRatio: 1,
                          borderRadius: theme.radii.md,
                          overflow: 'hidden',
                          backgroundColor: theme.colors.bg.surface,
                        }}
                      >
                        {signedUrls?.[post.photo_path ?? ''] ? (
                          <Image
                            source={{ uri: signedUrls[post.photo_path ?? ''] }}
                            style={{ width: '100%', height: '100%' }}
                            resizeMode="contain"
                            accessibilityLabel="Progress photo"
                          />
                        ) : null}
                      </View>
                    ) : (
                      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                        {(
                          [
                            { label: 'Before', path: post.before_photo_path },
                            { label: 'After', path: post.after_photo_path },
                          ] as const
                        ).map(({ label, path }) => (
                          <View
                            key={label}
                            style={{ flex: 1, gap: theme.spacing.xs }}
                          >
                            <Text variant="label" color="secondary">
                              {label.toUpperCase()}
                            </Text>
                            <View
                              style={{
                                width: '100%',
                                aspectRatio: 0.8,
                                borderRadius: theme.radii.md,
                                overflow: 'hidden',
                                backgroundColor: theme.colors.bg.surface,
                              }}
                            >
                              {path && signedUrls?.[path] ? (
                                <Image
                                  source={{ uri: signedUrls[path] }}
                                  style={{ width: '100%', height: '100%' }}
                                  resizeMode="contain"
                                  accessibilityLabel={`${label} photo`}
                                />
                              ) : null}
                            </View>
                          </View>
                        ))}
                      </View>
                    )}
                    <LikeBurst trigger={likeBurstTrigger} />
                  </View>
                </GestureDetector>

                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                  }}
                >
                  <Pressable
                    onPress={() => toggleLike.mutate(likedByMe)}
                    disabled={toggleLike.isPending}
                    hitSlop={8}
                    accessibilityLabel={likedByMe ? 'Unlike' : 'Like'}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: likedByMe
                        ? theme.colors.accent.primary
                        : theme.colors.bg.surfaceElevated,
                    }}
                  >
                    <Text style={{ fontSize: 16 }}>💪</Text>
                  </Pressable>
                  <Text variant="body" color="secondary">
                    {likes && likes.count > 0
                      ? `${likes.count} ${likes.count === 1 ? 'like' : 'likes'}`
                      : 'Be the first to like this'}
                  </Text>
                </View>

                {post.caption ? (
                  <Text variant="body" color="secondary">
                    {post.caption}
                  </Text>
                ) : null}

                <Text variant="label" color="secondary">
                  {comments && comments.length > 0
                    ? `${comments.length} COMMENTS`
                    : 'COMMENTS'}
                </Text>
              </View>
            }
          />

          <View
            style={{
              flexDirection: 'row',
              gap: theme.spacing.sm,
              alignItems: 'flex-end',
              padding: theme.spacing.lg,
              paddingBottom: theme.spacing.lg + tabBarHeight,
              borderTopWidth: 1,
              borderTopColor: theme.colors.border.subtle,
            }}
          >
            <View style={{ flex: 1 }}>
              <TextField
                value={commentDraft}
                onChangeText={setCommentDraft}
                placeholder="Add a comment..."
                multiline
                maxLength={500}
              />
            </View>
            <Button
              label="Post"
              size="sm"
              onPress={onPostComment}
              loading={createComment.isPending}
              disabled={commentDraft.trim().length === 0}
            />
          </View>
        </KeyboardAvoider>
      )}

      <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <ListRow
          title="Edit post"
          icon="pencil"
          onPress={() => {
            setMenuOpen(false);
            setEditOpen(true);
          }}
        />
        <ListRow
          title="Delete post"
          icon="trash"
          onPress={onDelete}
          style={{
            borderTopWidth: 1,
            borderTopColor: theme.colors.border.subtle,
          }}
        />
      </BottomSheet>

      <BottomSheet
        visible={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Post"
      >
        <View style={{ gap: theme.spacing.lg }}>
          <TextField
            label="Caption"
            value={editCaption}
            onChangeText={setEditCaption}
            placeholder="Add a caption (optional)"
            multiline
          />
          <VisibilitySelector
            value={editVisibility}
            onChange={setEditVisibility}
          />
          {editError ? (
            <Text
              variant="caption"
              style={{ color: theme.colors.semantic.danger }}
            >
              {editError}
            </Text>
          ) : null}
          <Button
            label="Save Changes"
            onPress={onSaveEdit}
            loading={updatePost.isPending}
          />
        </View>
      </BottomSheet>

      {post ? (
        <ReportBlockSheet
          visible={moderationOpen}
          onClose={() => setModerationOpen(false)}
          currentUserId={userId}
          targetType="post"
          targetId={post.id}
          reportedUserId={post.user_id}
          reportedUserName={owner?.display_name ?? undefined}
          onBlocked={() => navigation.goBack()}
        />
      ) : null}

      <ReportBlockSheet
        visible={reportingComment != null}
        onClose={() => setReportingComment(null)}
        currentUserId={userId}
        targetType="comment"
        targetId={reportingComment?.id ?? ''}
        reportedUserId={reportingComment?.user_id ?? ''}
        reportedUserName={reportingComment?.displayName ?? undefined}
      />
    </SafeAreaView>
  );
}
