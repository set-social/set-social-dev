import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useIncomingFriendRequests } from './community';

/** Whether there's a message worth the athlete's attention: an unread reply
 * in an accepted conversation (its last message isn't their own, and it
 * arrived after they last opened Messages), or a brand-new DM request
 * they haven't seen yet. No per-conversation read receipts — one cutoff
 * (profiles.messages_seen_at) covers the whole inbox. */
async function fetchHasUnreadMessages(userId: string, seenAt: string): Promise<boolean> {
  const [{ data: accepted, error: acceptedError }, { data: pending, error: pendingError }] = await Promise.all([
    supabase
      .from('dm_conversations')
      .select('id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`)
      .neq('last_message_sender_id', userId)
      .gt('last_message_at', seenAt)
      .limit(1),
    supabase.from('dm_conversations').select('id').eq('status', 'pending').eq('recipient_id', userId).gt('created_at', seenAt).limit(1),
  ]);
  if (acceptedError) throw acceptedError;
  if (pendingError) throw pendingError;
  return (accepted?.length ?? 0) > 0 || (pending?.length ?? 0) > 0;
}

export function useHasUnreadMessages(userId: string | null, seenAt: string | undefined) {
  return useQuery({
    queryKey: ['hasUnreadMessages', userId, seenAt],
    queryFn: () => fetchHasUnreadMessages(userId as string, seenAt as string),
    enabled: userId != null && seenAt != null,
  });
}

/** Whether someone else has liked or commented on one of the athlete's own
 * posts since they last checked their profile — two cheap existence checks
 * against tables that already exist, not a persisted activity log. Own
 * likes/comments on your own post don't count. */
async function fetchHasUnseenActivity(userId: string, seenAt: string): Promise<boolean> {
  const [{ data: likes, error: likesError }, { data: comments, error: commentsError }] = await Promise.all([
    supabase
      .from('post_likes')
      .select('id, posts!inner(user_id)')
      .eq('posts.user_id', userId)
      .neq('user_id', userId)
      .gt('created_at', seenAt)
      .limit(1),
    supabase
      .from('post_comments')
      .select('id, posts!inner(user_id)')
      .eq('posts.user_id', userId)
      .neq('user_id', userId)
      .gt('created_at', seenAt)
      .limit(1),
  ]);
  if (likesError) throw likesError;
  if (commentsError) throw commentsError;
  return (likes?.length ?? 0) > 0 || (comments?.length ?? 0) > 0;
}

export function useHasUnseenActivity(userId: string | null, seenAt: string | undefined) {
  return useQuery({
    queryKey: ['hasUnseenActivity', userId, seenAt],
    queryFn: () => fetchHasUnseenActivity(userId as string, seenAt as string),
    enabled: userId != null && seenAt != null,
  });
}

/** Call when the athlete opens Messages — clears the Messages tile's dot. */
export function useMarkMessagesSeen(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!userId) return;
      const { error } = await supabase
        .from('profiles')
        .update({ messages_seen_at: new Date().toISOString() })
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile', userId] }),
  });
}

/** Call when the athlete opens their own profile — clears the avatar's dot. */
export function useMarkActivitySeen(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!userId) return;
      const { error } = await supabase
        .from('profiles')
        .update({ activity_seen_at: new Date().toISOString() })
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile', userId] }),
  });
}

export type NotificationBadges = {
  hasUnreadMessages: boolean;
  hasUnseenActivity: boolean;
  hasIncomingFriendRequests: boolean;
  hasAny: boolean;
};

/** One combined read for "does the Social tab need a dot at all" — the
 * bottom tab bar only needs the aggregate; the Social tab's own header
 * needs the per-category pieces too (see CommunityPostsScreen), so this
 * returns both rather than collapsing to a single boolean. */
export function useNotificationBadges(
  userId: string | null,
  seenAt: { messagesSeenAt?: string; activitySeenAt?: string },
): NotificationBadges {
  const { data: hasUnreadMessages } = useHasUnreadMessages(userId, seenAt.messagesSeenAt);
  const { data: hasUnseenActivity } = useHasUnseenActivity(userId, seenAt.activitySeenAt);
  const { data: incomingRequests } = useIncomingFriendRequests(userId);
  const hasIncomingFriendRequests = (incomingRequests?.length ?? 0) > 0;

  return {
    hasUnreadMessages: hasUnreadMessages ?? false,
    hasUnseenActivity: hasUnseenActivity ?? false,
    hasIncomingFriendRequests,
    hasAny: (hasUnreadMessages ?? false) || (hasUnseenActivity ?? false) || hasIncomingFriendRequests,
  };
}
