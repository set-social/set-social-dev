import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import RNFS from 'react-native-fs';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../supabaseClient';
import type { Database } from '../../../types/database';

type FoodLogEntryRow = Database['public']['Tables']['food_log_entries']['Row'];
type FoodLogEntryInsert = Database['public']['Tables']['food_log_entries']['Insert'];
type FoodLogEntryUpdate = Database['public']['Tables']['food_log_entries']['Update'];

async function fetchFoodLogEntriesInRange(userId: string, from: string, to: string): Promise<FoodLogEntryRow[]> {
  const { data, error } = await supabase
    .from('food_log_entries')
    .select('*')
    .eq('user_id', userId)
    // Only confirmed entries count toward the day's totals — an
    // AI-photo-estimate row sits at status='pending' (see chat-coach's
    // log_food_estimate tool) until the athlete confirms or edits it via
    // FoodEstimateCard, so it must never silently move the dashboard.
    .eq('status', 'confirmed')
    .gte('logged_at', from)
    .lte('logged_at', to)
    .order('logged_at');
  if (error) throw error;
  return data ?? [];
}

/** Same {from, to} ISO-range shape as useWorkoutLogsInRange, so a caller
 * fetching "today" for both tables (see TodayScreen) can share the exact
 * same range strings. */
export function useFoodLogEntriesInRange(userId: string | null, range: { from: string; to: string }) {
  return useQuery({
    queryKey: ['foodLogEntries', 'range', userId, range.from, range.to],
    queryFn: () => fetchFoodLogEntriesInRange(userId as string, range.from, range.to),
    enabled: userId != null,
  });
}

export function useCreateFoodLogEntry(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entry: Omit<FoodLogEntryInsert, 'user_id'>) => {
      if (!userId) throw new Error('Not signed in');
      const { data, error } = await supabase
        .from('food_log_entries')
        .insert({ ...entry, user_id: userId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foodLogEntries'] });
    },
  });
}

export function useDeleteFoodLogEntry(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!userId) throw new Error('Not signed in');
      const { error } = await supabase.from('food_log_entries').delete().eq('id', id).eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foodLogEntries'] });
    },
  });
}

async function fetchFoodLogEntry(id: string): Promise<FoodLogEntryRow> {
  const { data, error } = await supabase.from('food_log_entries').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

/** Single-row fetch for FoodEstimateCard — deliberately not filtered by
 * status, unlike useFoodLogEntriesInRange, since this is exactly how a
 * still-pending AI estimate gets rendered and confirmed/edited in chat. */
export function useFoodLogEntry(id: string | null) {
  return useQuery({
    queryKey: ['foodLogEntries', 'byId', id],
    queryFn: () => fetchFoodLogEntry(id as string),
    enabled: id != null,
  });
}

/** Confirm and/or edit a pending AI estimate — plain client-side update
 * against the row chat-coach's log_food_estimate tool already created, no
 * second model round-trip needed since the athlete is just correcting
 * numbers already in front of them. */
export function useUpdateFoodLogEntry(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: FoodLogEntryUpdate & { id: string }) => {
      if (!userId) throw new Error('Not signed in');
      const { data, error } = await supabase
        .from('food_log_entries')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['foodLogEntries'] });
      queryClient.invalidateQueries({ queryKey: ['foodLogEntries', 'byId', variables.id] });
    },
  });
}

/** `{userId}/{unique}.{ext}` — no visibility segment needed the way
 * buildPostPhotoPath's does; a chat food photo is never shared. Same
 * RNFS.readFile + base64-arraybuffer upload uploadPostPhoto/useUploadAvatar
 * already use, avoiding fetch(uri).arrayBuffer()'s release-iOS hang. */
export function useUploadFoodPhoto(userId: string | null) {
  return useMutation({
    mutationFn: async (photo: { uri: string; contentType: string }): Promise<string> => {
      if (!userId) throw new Error('Not signed in');
      const extension = photo.contentType.split('/')[1] ?? 'jpg';
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const path = `${userId}/${unique}.${extension}`;
      const base64 = await RNFS.readFile(photo.uri, 'base64');
      const { error } = await supabase.storage
        .from('chat-photos')
        .upload(path, decode(base64), { contentType: photo.contentType });
      if (error) throw error;
      return path;
    },
  });
}

async function fetchSignedFoodPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from('chat-photos').createSignedUrls(paths, 3600);
  if (error) throw error;
  const result: Record<string, string> = {};
  for (const item of data) {
    if (item.signedUrl && item.path) result[item.path] = item.signedUrl;
  }
  return result;
}

/** One batched signed-URL request for however many chat photo paths are
 * visible at once, mirroring useSignedPhotoUrls (posts.ts) against the
 * private chat-photos bucket instead of post-photos. */
export function useSignedFoodPhotoUrls(paths: string[]) {
  const key = [...paths].sort().join(',');
  return useQuery({
    queryKey: ['signedFoodPhotoUrls', key],
    queryFn: () => fetchSignedFoodPhotoUrls(paths),
    enabled: paths.length > 0,
    // Signed URLs are valid for the 3600s requested above — treat them as
    // fresh for a while so re-rendering the chat doesn't re-request them.
    staleTime: 30 * 60 * 1000,
  });
}
