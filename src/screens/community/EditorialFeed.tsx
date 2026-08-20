import React, { useCallback } from 'react';
import {
  FlatList,
  View,
  type ListRenderItemInfo,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { LoadingState, EmptyState } from '../../components/core';
import { FeedPostCard } from './FeedPostCard';
import type { FriendPost } from '../../services/api/queries/posts';

type EditorialFeedProps = {
  posts: FriendPost[];
  /** Signed photo URLs, keyed by storage path — batched upstream, never fetched per-card. */
  photoUrls: Record<string, string>;
  /** Batched like/comment counts, keyed by post id — same "fetch once upstream" convention as photoUrls. */
  likeCounts: Record<string, number>;
  commentCounts: Record<string, number>;
  isLoading: boolean;
  emptyTitle: string;
  emptyDescription?: string;
  onPressPost: (postId: string) => void;
  onPressAuthor: (userId: string) => void;
  onPressMenu: (post: FriendPost) => void;
  /** Rendered above the post list, e.g. Friend Requests / Live Now — this
   * FlatList is meant to be the screen's one scroll container (see below),
   * so content that used to sit above EditorialFeed in an outer ScrollView
   * belongs here instead of wrapping this component in another scroll view. */
  ListHeaderComponent?: React.ReactElement | null;
  contentContainerStyle?: StyleProp<ViewStyle>;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle?: number;
};

/** The "Editorial Feed" — a vertical stream of FeedPostCards, replacing the
 * bare 3-column PostsGrid this screen used to render.
 *
 * A real FlatList, not a `.map()` over a plain View — friends' feeds can run
 * to dozens of posts, each with up to two images (PostThumbnail's
 * before/after mode), and an unvirtualized list mounts every one of them
 * regardless of scroll position. This is meant to be the screen's single
 * scroll container (via ListHeaderComponent/refreshControl/onScroll above)
 * rather than nested inside another ScrollView, which would both trigger
 * RN's nested-VirtualizedList warning and defeat windowing anyway — a
 * FlatList can't cull offscreen rows without owning its own scroll position. */
export function EditorialFeed({
  posts,
  photoUrls,
  likeCounts,
  commentCounts,
  isLoading,
  emptyTitle,
  emptyDescription,
  onPressPost,
  onPressAuthor,
  onPressMenu,
  ListHeaderComponent,
  contentContainerStyle,
  refreshControl,
  onScroll,
  scrollEventThrottle,
}: EditorialFeedProps) {
  const theme = useTheme();

  const renderItem = useCallback(
    ({ item: post }: ListRenderItemInfo<FriendPost>) => (
      <FeedPostCard
        post={post}
        photoUrl={post.photo_path ? photoUrls[post.photo_path] : undefined}
        beforeUrl={post.before_photo_path ? photoUrls[post.before_photo_path] : undefined}
        afterUrl={post.after_photo_path ? photoUrls[post.after_photo_path] : undefined}
        likeCount={likeCounts[post.id] ?? 0}
        commentCount={commentCounts[post.id] ?? 0}
        onPress={onPressPost}
        onPressAuthor={onPressAuthor}
        onPressMenu={onPressMenu}
      />
    ),
    [photoUrls, likeCounts, commentCounts, onPressPost, onPressAuthor, onPressMenu],
  );

  return (
    <FlatList
      data={posts}
      keyExtractor={post => post.id}
      renderItem={renderItem}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={
        isLoading ? (
          <LoadingState />
        ) : (
          <EmptyState icon="camera" title={emptyTitle} description={emptyDescription} />
        )
      }
      ItemSeparatorComponent={() => <View style={{ height: theme.spacing.md }} />}
      contentContainerStyle={contentContainerStyle}
      refreshControl={refreshControl}
      onScroll={onScroll}
      scrollEventThrottle={scrollEventThrottle}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    />
  );
}
