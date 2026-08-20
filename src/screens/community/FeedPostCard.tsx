import React from 'react';
import { Pressable, View } from 'react-native';
import { formatDistanceToNow } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Avatar, Card, PostThumbnail, IconButton } from '../../components/core';
import type { FriendPost } from '../../services/api/queries/posts';

type FeedPostCardProps = {
  post: FriendPost;
  photoUrl?: string;
  beforeUrl?: string;
  afterUrl?: string;
  likeCount: number;
  commentCount: number;
  // Take the post/id rather than being pre-bound per card, so the feed can
  // pass one stable function reference for the whole list (via useCallback)
  // instead of a fresh closure per card per render — required for the
  // React.memo below to actually skip unaffected cards.
  onPress: (postId: string) => void;
  onPressAuthor: (userId: string) => void;
  onPressMenu: (post: FriendPost) => void;
};

/**
 * The "Editorial Feed" card — author, photo, caption, and reaction counts
 * all live here, unlike the grid tile it replaces (PostThumbnail on its own
 * shows only the photo; everything else used to be a tap away on Post
 * Detail). Tapping the author row goes to their profile; tapping anything
 * else opens the post, via the standard RN nested-Pressable pattern (the
 * inner author Pressable's tap doesn't bubble to the outer one).
 *
 * Memoized — this renders inside EditorialFeed's FlatList, potentially
 * dozens of times per feed; without this every card re-renders whenever the
 * feed screen re-renders (e.g. a single like count changing), not just the
 * one that actually changed.
 */
export const FeedPostCard = React.memo(function FeedPostCard({
  post,
  photoUrl,
  beforeUrl,
  afterUrl,
  likeCount,
  commentCount,
  onPress,
  onPressAuthor,
  onPressMenu,
}: FeedPostCardProps) {
  const theme = useTheme();

  return (
    <Pressable onPress={() => onPress(post.id)}>
      <Card variant="elevated" style={{ gap: theme.spacing.sm, marginHorizontal: theme.spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable
            onPress={() => onPressAuthor(post.user_id)}
            accessibilityRole="button"
            accessibilityLabel={`View ${post.displayName ?? 'athlete'}'s profile`}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
          >
            <Avatar uri={post.avatarUrl} focalX={post.avatarFocalX} focalY={post.avatarFocalY} size={30} />
            <Text variant="body" style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>
              {post.displayName ?? 'Athlete'}
            </Text>
            <Text variant="caption" color="tertiary">
              {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
            </Text>
          </Pressable>
          <IconButton name="moreVertical" variant="ghost" size={28} accessibilityLabel="Post options" onPress={() => onPressMenu(post)} />
        </View>

        <PostThumbnail post={post} photoUrl={photoUrl} beforeUrl={beforeUrl} afterUrl={afterUrl} aspectRatio={4 / 5} radius={theme.radii.md} />

        {post.caption ? (
          <Text variant="body" color="secondary" numberOfLines={3}>
            {post.caption}
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <Text variant="caption" color="secondary">
            💪 {likeCount}
          </Text>
          <Text variant="caption" color="secondary">
            {commentCount === 1 ? '1 comment' : `${commentCount} comments`}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
});
