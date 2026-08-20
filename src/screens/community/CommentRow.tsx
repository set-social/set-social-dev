import React from 'react';
import { Pressable, View } from 'react-native';
import { formatDistanceToNow } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Avatar, IconButton } from '../../components/core';
import type { Comment } from '../../services/api/queries/comments';

type CommentRowProps = {
  comment: Comment;
  /** Whether the delete-comment trash icon should show for this row —
   * either the commenter themself, or the post owner moderating their own
   * post's comments. */
  canDelete: boolean;
  /** Whether the report/options icon should show — never for your own
   * comment. */
  canReport: boolean;
  // Take the comment/id rather than being pre-bound per row, so the list can
  // pass one stable function reference for the whole list (via useCallback)
  // instead of a fresh closure per row per render — required for the
  // React.memo below to actually skip unaffected rows.
  onPressAuthor: (userId: string) => void;
  onDelete: (commentId: string) => void;
  onReport: (comment: Comment) => void;
};

/** One row in a post's comment list. Memoized — this renders inside
 * PostDetailScreen's FlatList, potentially many times per post; without
 * this every row re-renders whenever the screen re-renders (a like toggled,
 * a new comment posted), not just the one that actually changed. */
export const CommentRow = React.memo(function CommentRow({
  comment,
  canDelete,
  canReport,
  onPressAuthor,
  onDelete,
  onReport,
}: CommentRowProps) {
  const theme = useTheme();

  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
      <Pressable
        onPress={() => onPressAuthor(comment.user_id)}
        accessibilityRole="button"
        accessibilityLabel={`View ${comment.displayName ?? 'athlete'}'s profile`}
        style={{
          flexDirection: 'row',
          gap: theme.spacing.sm,
          flex: 1,
        }}
      >
        <Avatar
          uri={comment.avatarUrl}
          focalX={comment.avatarFocalX}
          focalY={comment.avatarFocalY}
          size={32}
        />
        <View style={{ flex: 1 }}>
          <Text variant="body" style={{ fontWeight: '600' }}>
            {comment.displayName ?? 'Athlete'}
          </Text>
          <Text variant="body" color="secondary">
            {comment.body}
          </Text>
          <Text variant="caption" color="tertiary">
            {formatDistanceToNow(new Date(comment.created_at), {
              addSuffix: true,
            })}
          </Text>
        </View>
      </Pressable>
      {canDelete ? (
        <IconButton
          name="trash"
          variant="ghost"
          size={20}
          accessibilityLabel="Delete comment"
          onPress={() => onDelete(comment.id)}
        />
      ) : null}
      {canReport ? (
        <IconButton
          name="moreVertical"
          variant="ghost"
          size={20}
          accessibilityLabel="Comment options"
          onPress={() => onReport(comment)}
        />
      ) : null}
    </View>
  );
});
