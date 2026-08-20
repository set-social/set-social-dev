import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import RNFS from 'react-native-fs';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../supabaseClient';
import { fetchPublicProfiles, type PublicProfile } from './community';
import type { Database, DmConversationStatus, WorkoutShareStatus, WorkoutShareType } from '../../../types/database';

export type DmConversation = Database['public']['Tables']['dm_conversations']['Row'];
export type DmMessage = Database['public']['Tables']['dm_messages']['Row'];

export type ConversationSummary = DmConversation & { otherParticipant: PublicProfile | null };

function otherParticipantId(conversation: DmConversation, userId: string): string {
  return conversation.requester_id === userId ? conversation.recipient_id : conversation.requester_id;
}

async function fetchConversationsWithProfiles(
  userId: string,
  status: DmConversationStatus,
  direction?: 'incoming' | 'outgoing',
): Promise<ConversationSummary[]> {
  let query = supabase.from('dm_conversations').select('*').eq('status', status).order('last_message_at', { ascending: false });

  // Excludes whichever side the caller has deleted the conversation from —
  // "delete conversation" is per-participant (hidden_for_requester/
  // hidden_for_recipient), not a real row delete, so this filter is the
  // only place that removal is actually enforced on read.
  if (direction === 'incoming') {
    query = query.eq('recipient_id', userId).eq('hidden_for_recipient', false);
  } else if (direction === 'outgoing') {
    query = query.eq('requester_id', userId).eq('hidden_for_requester', false);
  } else {
    query = query.or(
      `and(requester_id.eq.${userId},hidden_for_requester.eq.false),` +
        `and(recipient_id.eq.${userId},hidden_for_recipient.eq.false)`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  const profiles = await fetchPublicProfiles(data.map(c => otherParticipantId(c, userId)));
  const profileById = new Map(profiles.map(p => [p.id, p]));
  return data.map(c => ({ ...c, otherParticipant: profileById.get(otherParticipantId(c, userId)) ?? null }));
}

/** Accepted conversations — the main inbox. */
export function useConversations(userId: string | null) {
  return useQuery({
    queryKey: ['dmConversations', userId],
    queryFn: () => fetchConversationsWithProfiles(userId as string, 'accepted'),
    enabled: userId != null,
  });
}

/** Pending requests where this user is the recipient — need a response. */
export function useIncomingDmRequests(userId: string | null) {
  return useQuery({
    queryKey: ['dmIncomingRequests', userId],
    queryFn: () => fetchConversationsWithProfiles(userId as string, 'pending', 'incoming'),
    enabled: userId != null,
  });
}

/** Pending requests this user sent, still awaiting the other side. */
export function useOutgoingDmRequests(userId: string | null) {
  return useQuery({
    queryKey: ['dmOutgoingRequests', userId],
    queryFn: () => fetchConversationsWithProfiles(userId as string, 'pending', 'outgoing'),
    enabled: userId != null,
  });
}

async function fetchConversation(conversationId: string, userId: string): Promise<ConversationSummary> {
  const { data, error } = await supabase.from('dm_conversations').select('*').eq('id', conversationId).single();
  if (error) throw error;
  const profiles = await fetchPublicProfiles([otherParticipantId(data, userId)]);
  return { ...data, otherParticipant: profiles[0] ?? null };
}

/** Single-conversation detail by id — same "refetch your own truth rather
 * than trust a caller-passed label" pattern the rest of this app's detail
 * screens use, so ConversationScreen doesn't need the other participant's
 * name/avatar threaded through as route params. */
export function useConversation(conversationId: string | undefined, userId: string | null) {
  return useQuery({
    queryKey: ['dmConversation', conversationId],
    queryFn: () => fetchConversation(conversationId as string, userId as string),
    enabled: conversationId != null && userId != null,
  });
}

function invalidateDmConversationQueries(queryClient: ReturnType<typeof useQueryClient>, userId: string) {
  queryClient.invalidateQueries({ queryKey: ['dmConversations', userId] });
  queryClient.invalidateQueries({ queryKey: ['dmIncomingRequests', userId] });
  queryClient.invalidateQueries({ queryKey: ['dmOutgoingRequests', userId] });
}

/** Find-or-create against the (requester, recipient) unordered-pair unique
 * index — messaging someone you already have a thread with (accepted,
 * pending, or even declined) reuses that same conversation rather than
 * erroring on the unique constraint or creating a duplicate. */
export function useStartConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { userId: string; otherUserId: string }) => {
      const { data: existing, error: selectError } = await supabase
        .from('dm_conversations')
        .select('*')
        .or(
          `and(requester_id.eq.${params.userId},recipient_id.eq.${params.otherUserId}),` +
            `and(requester_id.eq.${params.otherUserId},recipient_id.eq.${params.userId})`,
        )
        .maybeSingle();
      if (selectError) throw selectError;
      if (existing) return existing;

      const { data, error } = await supabase
        .from('dm_conversations')
        .insert({ requester_id: params.userId, recipient_id: params.otherUserId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, params) => invalidateDmConversationQueries(queryClient, params.userId),
  });
}

/** Only the recipient can accept/decline (enforced by RLS) — same mutation
 * either way, just a different target status. */
export function useRespondToConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; userId: string; status: 'accepted' | 'declined' }) => {
      const { error } = await supabase.from('dm_conversations').update({ status: params.status }).eq('id', params.id);
      if (error) throw error;
    },
    onSuccess: (_data, params) => invalidateDmConversationQueries(queryClient, params.userId),
  });
}

/** Trimmed to just what a message bubble needs to render — the review
 * screen re-fetches the full row (including `payload`) by id itself once
 * tapped, so this join doesn't need to carry the whole snapshot. */
export type DmMessageWorkoutShare = { id: string; share_type: WorkoutShareType; title: string; status: WorkoutShareStatus };

export type DmMessageWithLikes = DmMessage & {
  likeCount: number;
  likedByMe: boolean;
  workout_shares: DmMessageWorkoutShare | null;
};

async function fetchMessages(conversationId: string, userId: string): Promise<DmMessageWithLikes[]> {
  const { data, error } = await supabase
    .from('dm_messages')
    .select('*, dm_message_likes ( user_id ), workout_shares ( id, share_type, title, status )')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const rows = data as unknown as Array<
    DmMessage & { dm_message_likes: Array<{ user_id: string }>; workout_shares: DmMessageWorkoutShare | null }
  >;
  return rows.map(row => ({
    ...row,
    likeCount: row.dm_message_likes.length,
    likedByMe: row.dm_message_likes.some(l => l.user_id === userId),
    workout_shares: row.workout_shares,
  }));
}

export function useMessages(conversationId: string | undefined, userId: string | null) {
  return useQuery({
    queryKey: ['dmMessages', conversationId],
    queryFn: () => fetchMessages(conversationId as string, userId as string),
    enabled: conversationId != null && userId != null,
  });
}

/** `{conversationId}/{filename}` — keyed by conversation, not sender, since
 * both participants must be able to read a photo either of them sent
 * (mirrors post-photos' own path-encodes-access-scope pattern). */
function buildDmPhotoPath(conversationId: string, extension: string): string {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return `${conversationId}/${unique}.${extension}`;
}

async function uploadDmPhoto(conversationId: string, photo: { uri: string; contentType: string }): Promise<string> {
  const extension = photo.contentType.split('/')[1] ?? 'jpg';
  const path = buildDmPhotoPath(conversationId, extension);
  // Native file read rather than fetch(uri).arrayBuffer() — same fix as
  // post-photos' upload (unreliable on local file:// URIs in release iOS builds).
  const base64 = await RNFS.readFile(photo.uri, 'base64');
  const { error } = await supabase.storage.from('dm-photos').upload(path, decode(base64), { contentType: photo.contentType });
  if (error) throw error;
  return path;
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      conversationId: string;
      senderId: string;
      body?: string | null;
      photo?: { uri: string; contentType: string } | null;
    }) => {
      const photoPath = params.photo ? await uploadDmPhoto(params.conversationId, params.photo) : null;
      const { data, error } = await supabase
        .from('dm_messages')
        .insert({
          conversation_id: params.conversationId,
          sender_id: params.senderId,
          body: params.body ?? null,
          photo_path: photoPath,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ['dmMessages', params.conversationId] });
      invalidateDmConversationQueries(queryClient, params.senderId);
    },
  });
}

/** Unsend — sender-only (enforced by the dm_messages_delete_own RLS
 * policy), a real delete rather than a tombstone, mirroring this app's only
 * other message-like delete (post_comments). Removing the current last
 * message is recomputed server-side by the dm_untouch_conversation trigger,
 * so the inbox list still needs invalidating here same as useSendMessage. */
export function useDeleteMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { messageId: string; conversationId: string; userId: string; photoPath?: string | null }) => {
      if (params.photoPath) {
        await supabase.storage.from('dm-photos').remove([params.photoPath]).catch(() => undefined);
      }
      const { error } = await supabase.from('dm_messages').delete().eq('id', params.messageId);
      if (error) throw error;
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ['dmMessages', params.conversationId] });
      invalidateDmConversationQueries(queryClient, params.userId);
    },
  });
}

/** "Delete conversation" — removes it from just the caller's own inbox
 * (hidden_for_requester/hidden_for_recipient) rather than deleting real
 * data, via the set_dm_conversation_hidden() RPC (not a plain `.update()` —
 * dm_conversations has no RLS policy broad enough to let a client flip
 * these columns directly; see 0056_dm_delete.sql). Resurfaces automatically
 * the next time either side sends a message, so there's no "restore"
 * mutation to pair with this one. */
export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { conversationId: string; userId: string }) => {
      const client = supabase as unknown as {
        rpc: (
          fn: 'set_dm_conversation_hidden',
          args: { p_conversation_id: string; p_hidden: boolean },
        ) => Promise<{ error: { message: string } | null }>;
      };
      const { error } = await client.rpc('set_dm_conversation_hidden', {
        p_conversation_id: params.conversationId,
        p_hidden: true,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, params) => invalidateDmConversationQueries(queryClient, params.userId),
  });
}

export function useToggleMessageLike() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { messageId: string; conversationId: string; userId: string; currentlyLiked: boolean }) => {
      if (params.currentlyLiked) {
        const { error } = await supabase
          .from('dm_message_likes')
          .delete()
          .eq('message_id', params.messageId)
          .eq('user_id', params.userId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('dm_message_likes').insert({ message_id: params.messageId, user_id: params.userId });
        if (error) throw error;
      }
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ['dmMessages', params.conversationId] });
    },
  });
}

async function fetchSignedDmPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from('dm-photos').createSignedUrls(paths, 3600);
  if (error) throw error;
  const result: Record<string, string> = {};
  for (const item of data) {
    if (item.signedUrl && item.path) result[item.path] = item.signedUrl;
  }
  return result;
}

export function useSignedDmPhotoUrls(paths: string[]) {
  const key = [...paths].sort().join(',');
  return useQuery({
    queryKey: ['signedDmPhotoUrls', key],
    queryFn: () => fetchSignedDmPhotoUrls(paths),
    enabled: paths.length > 0,
    staleTime: 30 * 60 * 1000,
  });
}

/** Live delivery while a conversation is open — the one place in this app
 * that uses Supabase Realtime rather than refetch-on-focus/pull-to-refresh.
 * Scoped to a single conversation's channel; the inbox list still relies on
 * ordinary refetching. Owns the cache append itself (dedup'd by id, since
 * the sender's own optimistic/invalidated refetch can race this same
 * event) rather than handing a raw callback out to the screen — query-cache
 * access stays inside this file, matching every other hook here. */
export function useConversationRealtime(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`dm:${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: `conversation_id=eq.${conversationId}` },
        payload => {
          const message = payload.new as DmMessage;
          // A shared-workout message needs its workout_shares join (title,
          // share_type, status) to render — postgres_changes payloads carry
          // the raw row only, no joins, so it can't be appended optimistically
          // like a plain text/photo message. Falls back to a refetch instead.
          if (message.workout_share_id != null) {
            queryClient.invalidateQueries({ queryKey: ['dmMessages', conversationId] });
            return;
          }
          queryClient.setQueryData<DmMessageWithLikes[]>(['dmMessages', conversationId], old => {
            if (!old) return old;
            if (old.some(m => m.id === message.id)) return old;
            return [...old, { ...message, likeCount: 0, likedByMe: false, workout_shares: null }];
          });
        },
      )
      .on(
        // Lets the other participant see an unsent message disappear live.
        // Needs dm_messages' replica identity set to FULL (0056_dm_delete.sql)
        // — with the default (primary-key-only) identity, the old-row image
        // on a DELETE wouldn't include conversation_id, and this filter would
        // never match.
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'dm_messages', filter: `conversation_id=eq.${conversationId}` },
        payload => {
          const deletedId = (payload.old as Partial<DmMessage>).id;
          if (!deletedId) return;
          queryClient.setQueryData<DmMessageWithLikes[]>(['dmMessages', conversationId], old =>
            old ? old.filter(m => m.id !== deletedId) : old,
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient]);
}
