import { useMutation, useQuery } from '@tanstack/react-query';
import RNFS from 'react-native-fs';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../supabaseClient';
import { analyzeFormCheck, type FormCheckResult } from '../edgeFunctions';

/** `{userId}/{unique}.{ext}` — same RNFS.readFile + base64-arraybuffer
 * upload useUploadFoodPhoto (foodLog.ts) already uses, targeting the
 * form-check-photos bucket instead of chat-photos. Called once per frame —
 * a photo is one call, a video's sampled frames are several. */
export function useUploadFormCheckPhoto(userId: string | null) {
  return useMutation({
    mutationFn: async (photo: { uri: string; contentType: string }): Promise<string> => {
      if (!userId) throw new Error('Not signed in');
      const extension = photo.contentType.split('/')[1] ?? 'jpg';
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const path = `${userId}/${unique}.${extension}`;
      const base64 = await RNFS.readFile(photo.uri, 'base64');
      const { error } = await supabase.storage
        .from('form-check-photos')
        .upload(path, decode(base64), { contentType: photo.contentType });
      if (error) throw error;
      return path;
    },
  });
}

export function useAnalyzeFormCheck() {
  return useMutation({
    mutationFn: (input: { exercise_id: string; exercise_name: string; photo_paths: string[] }): Promise<FormCheckResult> =>
      analyzeFormCheck(input),
  });
}

/** Count of this month's checks, so FormCheckScreen can show/gate on the
 * free-tier cap up front — same "X of 3 used" pattern ChatScreen derives
 * from its own messages query, except form_check_results isn't loaded
 * anywhere else on screen, so this fetches the count directly rather than
 * filtering an already-cached list. The edge function (form-check/index.ts)
 * re-checks this server-side regardless; this is only the client-side hint
 * and a way to skip a wasted upload once the count is obviously at the cap. */
export function useFormCheckUsage(userId: string | null) {
  return useQuery({
    queryKey: ['form_check_usage', userId],
    queryFn: async (): Promise<number> => {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const { count, error } = await supabase
        .from('form_check_results')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId as string)
        .gte('created_at', monthStart.toISOString());
      if (error) throw error;
      return count ?? 0;
    },
    enabled: userId != null,
  });
}
