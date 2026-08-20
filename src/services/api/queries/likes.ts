import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';

export type LikeSummary = {
  count: number;
  likedByMe: boolean;
};

async function fetchLikes(postId: string, userId: string): Promise<LikeSummary> {
  const { data, error } = await supabase.from('post_likes').select('user_id').eq('post_id', postId);
  if (error) throw error;
  return {
    count: data.length,
    likedByMe: data.some(row => row.user_id === userId),
  };
}

export function useLikes(postId: string | null, userId: string | null) {
  return useQuery({
    queryKey: ['likes', postId],
    queryFn: () => fetchLikes(postId as string, userId as string),
    enabled: postId != null && userId != null,
  });
}

/** One batched count-per-post query for a feed, rather than a `useLikes` call
 * per card — a 60-post feed would otherwise fire 60 separate requests just
 * to show a number nobody asked to interact with yet. */
async function fetchLikeCounts(postIds: string[]): Promise<Record<string, number>> {
  if (postIds.length === 0) return {};
  const { data, error } = await supabase.from('post_likes').select('post_id').in('post_id', postIds);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data) counts[row.post_id] = (counts[row.post_id] ?? 0) + 1;
  return counts;
}

export function useLikeCounts(postIds: string[]) {
  const key = [...postIds].sort().join(',');
  return useQuery({
    queryKey: ['likeCounts', key],
    queryFn: () => fetchLikeCounts(postIds),
    enabled: postIds.length > 0,
  });
}

/**
 * Takes the *current* liked state as its mutate-time argument rather than
 * inferring it server-side, so a double-tap-to-like gesture (which must
 * never unlike, only like) and a single-tap toggle button can share one
 * mutation while each deciding for itself whether a call should be a no-op.
 */
export function useToggleLike(postId: string | null, userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (currentlyLiked: boolean) => {
      if (!postId || !userId) throw new Error('Not signed in');
      if (currentlyLiked) {
        const { error } = await supabase
          .from('post_likes')
          .delete()
          .eq('post_id', postId)
          .eq('user_id', userId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('post_likes').insert({ post_id: postId, user_id: userId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['likes', postId] });
      queryClient.invalidateQueries({ queryKey: ['likeCounts'] });
    },
  });
}
