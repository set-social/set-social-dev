import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import RNFS from 'react-native-fs';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../supabaseClient';
import { fetchFriendIds, fetchPublicProfiles, type PublicProfile } from './community';
import type { Database, PostVisibility } from '../../../types/database';

export type Post = Database['public']['Tables']['posts']['Row'];
export type FriendPost = Post & {
  displayName: string | null;
  avatarUrl: string | null;
  avatarFocalX: number;
  avatarFocalY: number;
};

type PhotoInput = { uri: string; contentType: string };

type CreatePhotoPostParams =
  | { mode: 'progress'; visibility: PostVisibility; caption: string | null; photo: PhotoInput; taggedUserIds?: string[] }
  | {
      mode: 'before_after';
      visibility: PostVisibility;
      caption: string | null;
      beforePhoto: PhotoInput;
      afterPhoto: PhotoInput;
      taggedUserIds?: string[];
    };

/**
 * `{userId}/{visibility}/{filename}` — visibility is encoded directly in
 * the storage path so Storage RLS (post_photos_friends_select) never needs
 * to join back to the posts table to know whether a given file is private.
 */
export function buildPostPhotoPath(userId: string, visibility: PostVisibility, extension: string): string {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return `${userId}/${visibility}/${unique}.${extension}`;
}

function extensionFromContentType(contentType: string): string {
  return contentType.split('/')[1] ?? 'jpg';
}

async function uploadPostPhoto(userId: string, visibility: PostVisibility, photo: PhotoInput): Promise<string> {
  const path = buildPostPhotoPath(userId, visibility, extensionFromContentType(photo.contentType));
  // `fetch(uri).arrayBuffer()` on a local file:// URI is unreliable in
  // release iOS builds — it can reject with "Network request failed" (this
  // screen's reported bug) or hang indefinitely. Read the file natively
  // instead, matching the avatar upload fix in profiles.ts.
  const base64 = await RNFS.readFile(photo.uri, 'base64');
  const { error } = await supabase.storage
    .from('post-photos')
    .upload(path, decode(base64), { contentType: photo.contentType });
  if (error) throw error;
  return path;
}

/** Tags are best-effort: a failure here shouldn't undo an otherwise-successful
 * post (the photo's already uploaded and the row already exists) — it just
 * means the post goes out untagged, same as if the athlete had skipped
 * tagging in the first place. */
async function insertPostTags(postId: string, taggedUserIds: string[] | undefined): Promise<void> {
  if (!taggedUserIds || taggedUserIds.length === 0) return;
  const { error } = await supabase
    .from('post_tags')
    .insert(taggedUserIds.map(taggedUserId => ({ post_id: postId, tagged_user_id: taggedUserId })));
  if (error) console.error('Could not tag one or more people on this post', error);
}

export function useCreatePhotoPost(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: CreatePhotoPostParams) => {
      if (!userId) throw new Error('Not signed in');

      if (params.mode === 'progress') {
        const photoPath = await uploadPostPhoto(userId, params.visibility, params.photo);
        const { data, error } = await supabase
          .from('posts')
          .insert({
            user_id: userId,
            post_type: 'progress_photo',
            visibility: params.visibility,
            caption: params.caption,
            photo_path: photoPath,
          })
          .select('id')
          .single();
        if (error) throw error;
        await insertPostTags(data.id, params.taggedUserIds);
        return;
      }

      const [beforePhotoPath, afterPhotoPath] = await Promise.all([
        uploadPostPhoto(userId, params.visibility, params.beforePhoto),
        uploadPostPhoto(userId, params.visibility, params.afterPhoto),
      ]);
      const { data, error } = await supabase
        .from('posts')
        .insert({
          user_id: userId,
          post_type: 'before_after_photo',
          visibility: params.visibility,
          caption: params.caption,
          before_photo_path: beforePhotoPath,
          after_photo_path: afterPhotoPath,
        })
        .select('id')
        .single();
      if (error) throw error;
      await insertPostTags(data.id, params.taggedUserIds);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts', userId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Reading posts back — RLS on `posts` already guarantees a private post is
// only ever returned to its owner, so these queries need no client-side
// visibility filtering: the same fetchUserPosts works for "my own profile"
// (owner sees everything) and "a friend's profile" (their private posts are
// silently excluded server-side).
// ---------------------------------------------------------------------------

async function fetchUserPosts(userId: string): Promise<Post[]> {
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export function useUserPosts(userId: string | null) {
  return useQuery({
    queryKey: ['posts', userId],
    queryFn: () => fetchUserPosts(userId as string),
    enabled: userId != null,
  });
}

const FRIENDS_POSTS_LIMIT = 60;

/** No pagination yet — same scope-limit call feed.ts's FEED_LIMIT made, just posts-only now. */
export async function fetchFriendsPosts(userId: string): Promise<FriendPost[]> {
  const friendIds = await fetchFriendIds(userId);
  if (friendIds.length === 0) return [];

  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .in('user_id', friendIds)
    .order('created_at', { ascending: false })
    .limit(FRIENDS_POSTS_LIMIT);
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

/** Backs both Home's 3-post preview and the Community "Posts" grid — one query, sliced differently by each caller. */
export function useFriendsPosts(userId: string | null) {
  return useQuery({
    queryKey: ['friendsPosts', userId],
    queryFn: () => fetchFriendsPosts(userId as string),
    enabled: userId != null,
  });
}

/** Every storage path a post references, for batching into a single useSignedPhotoUrls call. */
export function postPhotoPaths(post: Post): string[] {
  if (post.post_type === 'progress_photo') return post.photo_path ? [post.photo_path] : [];
  return [post.before_photo_path, post.after_photo_path].filter((p): p is string => p != null);
}

/** Swaps the `{userId}/{visibility}/{filename}` segment — the visibility
 * change itself moves the underlying object, since Storage RLS
 * (post_photos_friends_select) keys off that path segment, not a DB column. */
function pathWithVisibility(path: string, visibility: PostVisibility): string {
  const parts = path.split('/');
  parts[1] = visibility;
  return parts.join('/');
}

/** Edits caption and/or visibility on the caller's own post. A visibility
 * change moves every photo the post references to the matching path
 * prefix first — Storage access is gated by that path segment, so the DB
 * row and the file location must never disagree about who can see it. */
export function useUpdatePost(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { post: Post; caption: string | null; visibility: PostVisibility }) => {
      if (!userId) throw new Error('Not signed in');
      const { post } = params;
      const updates: Database['public']['Tables']['posts']['Update'] = { caption: params.caption };

      if (params.visibility !== post.visibility) {
        const paths = postPhotoPaths(post);
        const moved: Record<string, string> = {};
        try {
          for (const path of paths) {
            const newPath = pathWithVisibility(path, params.visibility);
            const { error } = await supabase.storage.from('post-photos').move(path, newPath);
            if (error) throw error;
            moved[path] = newPath;
          }
        } catch (err) {
          // Best-effort rollback of whatever already moved, so a mid-flight
          // failure can't leave the visibility flag and the file location
          // disagreeing about who can see the photo.
          await Promise.all(
            Object.entries(moved).map(([from, to]) => supabase.storage.from('post-photos').move(to, from)),
          );
          throw err;
        }

        updates.visibility = params.visibility;
        if (post.post_type === 'progress_photo' && post.photo_path) {
          updates.photo_path = moved[post.photo_path];
        } else if (post.post_type === 'before_after_photo') {
          if (post.before_photo_path) updates.before_photo_path = moved[post.before_photo_path];
          if (post.after_photo_path) updates.after_photo_path = moved[post.after_photo_path];
        }
      }

      const { data, error } = await supabase.from('posts').update(updates).eq('id', post.id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: updated => {
      queryClient.setQueryData(['post', updated.id], updated);
      queryClient.invalidateQueries({ queryKey: ['posts', userId] });
      queryClient.invalidateQueries({ queryKey: ['friendsPosts'] });
      queryClient.invalidateQueries({ queryKey: ['signedPhotoUrls'] });
    },
  });
}

/** Deletes the caller's own post. Storage cleanup is best-effort — an RLS
 * failure there shouldn't block removing the post itself, and any orphaned
 * object stays inaccessible to everyone but its (former) owner regardless. */
export function useDeletePost(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (post: Post) => {
      if (!userId) throw new Error('Not signed in');
      const paths = postPhotoPaths(post);
      if (paths.length > 0) {
        await supabase.storage.from('post-photos').remove(paths).catch(() => undefined);
      }
      const { error } = await supabase.from('posts').delete().eq('id', post.id);
      if (error) throw error;
    },
    onSuccess: (_data, post) => {
      queryClient.removeQueries({ queryKey: ['post', post.id] });
      queryClient.invalidateQueries({ queryKey: ['posts', userId] });
      queryClient.invalidateQueries({ queryKey: ['friendsPosts'] });
    },
  });
}

async function fetchPost(postId: string): Promise<Post | null> {
  const { data, error } = await supabase.from('posts').select('*').eq('id', postId).maybeSingle();
  if (error) throw error;
  return data;
}

export function usePost(postId: string | null) {
  return useQuery({
    queryKey: ['post', postId],
    queryFn: () => fetchPost(postId as string),
    enabled: postId != null,
  });
}

export type TaggedProfile = PublicProfile;

/** Tag rows inherit `posts`' own RLS (see 0039_post_tags.sql), so this never
 * needs client-side visibility filtering either — same reasoning as fetchUserPosts. */
async function fetchPostTags(postId: string): Promise<TaggedProfile[]> {
  const { data, error } = await supabase.from('post_tags').select('tagged_user_id').eq('post_id', postId);
  if (error) throw error;
  return fetchPublicProfiles(data.map(row => row.tagged_user_id));
}

export function usePostTags(postId: string | null) {
  return useQuery({
    queryKey: ['postTags', postId],
    queryFn: () => fetchPostTags(postId as string),
    enabled: postId != null,
  });
}

async function fetchSignedPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from('post-photos').createSignedUrls(paths, 3600);
  if (error) throw error;
  const result: Record<string, string> = {};
  for (const item of data) {
    if (item.signedUrl && item.path) result[item.path] = item.signedUrl;
  }
  return result;
}

/** One batched signed-URL request for however many photo paths a screen needs, not one request per photo. */
export function useSignedPhotoUrls(paths: string[]) {
  const key = [...paths].sort().join(',');
  return useQuery({
    queryKey: ['signedPhotoUrls', key],
    queryFn: () => fetchSignedPhotoUrls(paths),
    enabled: paths.length > 0,
    // Signed URLs are valid for the 3600s requested above — treat them as
    // fresh for a while so switching screens doesn't re-request the same URLs.
    staleTime: 30 * 60 * 1000,
  });
}
