import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { fetchPublicProfiles } from './community';
import type { Database } from '../../../types/database';

export type Comment = Database['public']['Tables']['post_comments']['Row'] & {
  displayName: string | null;
  avatarUrl: string | null;
  avatarFocalX: number;
  avatarFocalY: number;
};

async function fetchComments(postId: string): Promise<Comment[]> {
  const { data, error } = await supabase
    .from('post_comments')
    .select('*')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const authorIds = Array.from(new Set(data.map(row => row.user_id)));
  const profiles = await fetchPublicProfiles(authorIds);
  const profileById = new Map(profiles.map(profile => [profile.id, profile]));

  return data.map(row => ({
    ...row,
    displayName: profileById.get(row.user_id)?.display_name ?? null,
    avatarUrl: profileById.get(row.user_id)?.avatar_url ?? null,
    avatarFocalX: profileById.get(row.user_id)?.avatar_focal_x ?? 0.5,
    avatarFocalY: profileById.get(row.user_id)?.avatar_focal_y ?? 0.5,
  }));
}

export function useComments(postId: string | null) {
  return useQuery({
    queryKey: ['comments', postId],
    queryFn: () => fetchComments(postId as string),
    enabled: postId != null,
  });
}

/** Batched count-per-post, same reasoning as likes.ts's useLikeCounts — a
 * feed card needs the number, not the full comment list. */
async function fetchCommentCounts(postIds: string[]): Promise<Record<string, number>> {
  if (postIds.length === 0) return {};
  const { data, error } = await supabase.from('post_comments').select('post_id').in('post_id', postIds);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data) counts[row.post_id] = (counts[row.post_id] ?? 0) + 1;
  return counts;
}

export function useCommentCounts(postIds: string[]) {
  const key = [...postIds].sort().join(',');
  return useQuery({
    queryKey: ['commentCounts', key],
    queryFn: () => fetchCommentCounts(postIds),
    enabled: postIds.length > 0,
  });
}

export function useCreateComment(postId: string | null, userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      if (!postId || !userId) throw new Error('Not signed in');
      const { error } = await supabase.from('post_comments').insert({ post_id: postId, user_id: userId, body });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', postId] });
      queryClient.invalidateQueries({ queryKey: ['commentCounts'] });
    },
  });
}

export function useDeleteComment(postId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (commentId: string) => {
      const { error } = await supabase.from('post_comments').delete().eq('id', commentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', postId] });
      queryClient.invalidateQueries({ queryKey: ['commentCounts'] });
    },
  });
}
