import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import RNFS from 'react-native-fs';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../supabaseClient';
import type { Database } from '../../../types/database';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

export async function fetchProfile(userId: string): Promise<ProfileRow> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

export function useProfile(userId: string | null) {
  return useQuery({
    queryKey: ['profile', userId],
    queryFn: () => fetchProfile(userId as string),
    enabled: userId != null,
  });
}

export function useUpdateProfile(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updates: ProfileUpdate) => {
      if (!userId) throw new Error('Not signed in');
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: updated => {
      queryClient.setQueryData(['profile', userId], updated);
    },
  });
}

/** Uploads a picked photo to the `avatars` storage bucket (one file per user,
 * re-uploaded in place via upsert) and points profiles.avatar_url at it. */
export function useUploadAvatar(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { uri: string; contentType: string }) => {
      if (!userId) throw new Error('Not signed in');
      const extension = params.contentType.split('/')[1] ?? 'jpg';
      const path = `${userId}/avatar.${extension}`;

      // Reading the picked file via `fetch(uri).arrayBuffer()` is unreliable
      // on release iOS builds — the promise can hang indefinitely for local
      // file:// URIs, leaving the UI stuck "uploading" even though nothing
      // ever reaches the network. Read it natively as base64 instead.
      const base64 = await RNFS.readFile(params.uri, 'base64');
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, decode(base64), { contentType: params.contentType, upsert: true });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(path);
      // Cache-bust so re-uploading the same path shows the new photo immediately.
      const avatarUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;

      // A brand new photo resets to a plain center crop — the focal point
      // from whatever the old photo was framed to almost never lands on the
      // right spot in an unrelated image.
      const { data, error } = await supabase
        .from('profiles')
        .update({ avatar_url: avatarUrl, avatar_focal_x: 0.5, avatar_focal_y: 0.5 })
        .eq('id', userId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: updated => {
      queryClient.setQueryData(['profile', userId], updated);
    },
  });
}
