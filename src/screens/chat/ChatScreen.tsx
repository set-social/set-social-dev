import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  launchCamera,
  launchImageLibrary,
  type Asset,
} from 'react-native-image-picker';
import { useTheme, type Theme } from '../../theme/ThemeProvider';
import {
  Text,
  TextField,
  Button,
  Card,
  IconButton,
  BottomSheet,
  ListRow,
  LoadingState,
  EmptyState,
  KeyboardAvoider,
  BetaBadge,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useChatUiStore } from '../../store/chatUiStore';
import { useProfile } from '../../services/api/queries/profiles';
import {
  useConversation,
  useMessages,
  useInvalidateMessages,
  useClearChat,
} from '../../services/api/queries/chat';
import {
  useUploadFoodPhoto,
  useSignedFoodPhotoUrls,
} from '../../services/api/queries/foodLog';
import {
  sendChatMessage,
  EdgeFunctionError,
} from '../../services/api/edgeFunctions';
import { supabase } from '../../services/api/supabaseClient';
import { FoodEstimateCard } from './FoodEstimateCard';
import { featureFlags } from '../../config/featureFlags';
import type { RootStackParamList } from '../../navigation/types';
import type { ChatRole } from '../../types/database';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type ChatRouteProp = RouteProp<RootStackParamList, 'Chat'>;

// Keep in sync with FREE_MESSAGES_PER_MONTH in
// supabase/functions/chat-coach/index.ts — this is only the client-side
// "X of 3 used" hint and a way to skip a wasted round trip once the count
// is obviously already at the cap; the edge function is what actually
// enforces it.
const FREE_MESSAGES_PER_MONTH = 3;

export function ChatScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const route = useRoute<ChatRouteProp>();
  const inputRef = useRef<TextInput>(null);
  const userId = useAuthStore(state => state.userId);
  const { data: profile } = useProfile(userId);
  const isPremium = profile?.is_premium ?? false;
  const { data: conversation } = useConversation(userId);
  const conversationId = conversation?.id ?? null;
  const { data: messages, isLoading } = useMessages(conversationId);
  const invalidateMessages = useInvalidateMessages(conversationId);
  const clearChat = useClearChat(conversationId);
  const queryClient = useQueryClient();

  const messagesUsedThisMonth = React.useMemo(() => {
    if (isPremium || !messages) return 0;
    const monthStart = format(new Date(), 'yyyy-MM-01');
    return messages.filter(m => m.role === 'user' && m.created_at >= monthStart)
      .length;
  }, [messages, isPremium]);
  const atFreeLimit =
    !isPremium && messagesUsedThisMonth >= FREE_MESSAGES_PER_MONTH;

  const streamingBuffer = useChatUiStore(state => state.streamingBuffer);
  const appendToken = useChatUiStore(state => state.appendToken);
  const resetStreamingBuffer = useChatUiStore(
    state => state.resetStreamingBuffer,
  );

  const [input, setInput] = useState('');
  const [attachedPhoto, setAttachedPhoto] = useState<{
    uri: string;
    contentType: string;
  } | null>(null);
  const [pendingUserText, setPendingUserText] = useState<string | null>(null);
  const [pendingUserPhotoUri, setPendingUserPhotoUri] = useState<string | null>(
    null,
  );
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optionsSheetOpen, setOptionsSheetOpen] = useState(false);
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Home Screen widget's "Log Food" deep link (soset://chat?openFoodLog=1,
  // see WIDGET_LOG_FOOD_DEEP_LINK) — focuses the input rather than
  // prefilling text, since a photo or typed description replaces it anyway.
  // Read once on mount; navigating here again later (a normal tab tap)
  // never re-triggers this since route.params only carries the flag the one
  // time React Navigation actually parsed it off the URL.
  useEffect(() => {
    if (route.params?.openFoodLog) {
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const uploadFoodPhoto = useUploadFoodPhoto(userId);

  // One batched signed-URL request for every photo this conversation
  // references, not one per bubble — same convention useSignedPhotoUrls
  // already established for posts (see foodLog.ts's doc comment).
  const photoPaths = useMemo(
    () =>
      (messages ?? [])
        .map(m => m.photo_path)
        .filter((p): p is string => p != null),
    [messages],
  );
  const { data: signedPhotoUrls } = useSignedFoodPhotoUrls(photoPaths);

  const onClearChat = () => {
    setOptionsSheetOpen(false);
    Alert.alert(
      'Clear this chat?',
      "This can't be undone — Arnold won't remember this conversation.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            resetStreamingBuffer();
            setPendingUserText(null);
            setError(null);
            try {
              await clearChat.mutateAsync();
            } catch (err) {
              Alert.alert(
                'Could not clear chat',
                err instanceof Error ? err.message : 'Please try again.',
              );
            }
          },
        },
      ],
    );
  };

  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`chat-${conversationId}`)
      .on('broadcast', { event: 'token' }, ({ payload }) => {
        appendToken(payload.delta as string);
      })
      .on('broadcast', { event: 'done' }, () => {
        resetStreamingBuffer();
        setPendingUserText(null);
        setPendingUserPhotoUri(null);
        setSending(false);
        invalidateMessages();
        // Cheap no-op if the coach didn't touch the schedule this turn — but
        // if it did (removed/curated/scheduled a workout via a tool call),
        // this is what makes Today/Calendar/Library reflect it right away
        // instead of waiting out the normal staleTime.
        queryClient.invalidateQueries({ queryKey: ['scheduledWorkouts'] });
        queryClient.invalidateQueries({ queryKey: ['workoutTemplates'] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Single send path for both text-only and photo(+caption) turns — a photo
  // is staged via attachedPhoto (see onPickPhoto below) rather than uploaded
  // and sent the instant it's picked, so the athlete can still add a note
  // ("log this for breakfast") before it goes out.
  const onSend = async () => {
    const text = input.trim();
    const photo = attachedPhoto;
    if ((!text && !photo) || !conversationId || sending) return;
    if (atFreeLimit) {
      navigation.navigate('Paywall', { trigger: 'ai_chat' });
      return;
    }
    setInput('');
    setAttachedPhoto(null);
    setPendingUserText(text || null);
    setPendingUserPhotoUri(photo?.uri ?? null);
    setSending(true);
    setError(null);
    resetStreamingBuffer();
    try {
      let photoPath: string | undefined;
      if (photo) {
        setUploadingPhoto(true);
        photoPath = await uploadFoodPhoto.mutateAsync(photo);
        setUploadingPhoto(false);
      }
      await sendChatMessage(
        conversationId,
        text,
        format(new Date(), 'yyyy-MM-dd'),
        photoPath,
      );
    } catch (err) {
      setSending(false);
      setUploadingPhoto(false);
      setPendingUserPhotoUri(null);
      setPendingUserText(null);
      if (
        err instanceof EdgeFunctionError &&
        err.code === 'free_limit_reached'
      ) {
        setInput(text); // hand the draft back rather than discarding it
        setAttachedPhoto(photo);
        navigation.navigate('Paywall', { trigger: 'ai_chat' });
        return;
      }
      setError(
        err instanceof Error ? err.message : 'Could not send that. Try again.',
      );
    }
  };

  // BottomSheet's Modal stays natively presented through its own ~200ms
  // close animation — presenting the camera/library picker immediately on
  // tap (while that modal is still dismissing) silently drops the
  // presentation on iOS instead of opening it, not just a glitch. So a tap
  // only records *which* picker to open; the actual launch is deferred to
  // BottomSheet's onDismissed, once it's truly gone (same pattern as
  // PostFab's photo picker, src/navigation/PostFab.tsx).
  const pendingPickerRef = useRef<'camera' | 'library' | null>(null);

  // Only stages the photo — sending (upload + sendChatMessage) happens from
  // onSend once the athlete taps Send, so they get a chance to add a note
  // first. maxWidth/maxHeight cap the picker's own on-device resize to
  // Anthropic's documented vision sweet spot (images with a longer edge
  // past 1568px are just downscaled server-side anyway, so anything bigger
  // is wasted upload/encode/transfer time for zero accuracy gain).
  const onPickPhoto = async (source: 'camera' | 'library') => {
    if (sending) return;
    if (atFreeLimit) {
      navigation.navigate('Paywall', { trigger: 'ai_chat' });
      return;
    }

    const launch = source === 'camera' ? launchCamera : launchImageLibrary;
    const result = await launch({
      mediaType: 'photo',
      quality: 0.8,
      maxWidth: 1568,
      maxHeight: 1568,
    });
    if (result.didCancel) return;
    if (result.errorCode) {
      Alert.alert(
        source === 'camera'
          ? 'Could not open camera'
          : 'Could not open photo library',
        result.errorMessage ?? 'Please try again.',
      );
      return;
    }
    const asset: Asset | undefined = result.assets?.[0];
    if (!asset?.uri) return;

    setAttachedPhoto({
      uri: asset.uri,
      contentType: asset.type ?? 'image/jpeg',
    });
  };

  const onTakePhoto = () => {
    pendingPickerRef.current = 'camera';
    setAttachSheetOpen(false);
  };

  const onChooseFromLibrary = () => {
    pendingPickerRef.current = 'library';
    setAttachSheetOpen(false);
  };

  const onAttachSheetDismissed = () => {
    const source = pendingPickerRef.current;
    pendingPickerRef.current = null;
    if (source) onPickPhoto(source);
  };

  return (
    // Top inset is applied explicitly below rather than left to SafeAreaView's
    // automatic edge — this screen covers the true top of the display, status
    // bar included (see RootNavigator's `presentation: 'card'` on this
    // screen), and the collapse button needs a guaranteed floor of clearance
    // on every device regardless of what the navigation layer reports for
    // insets.top.
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg.base }}
      edges={['left', 'right', 'bottom']}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: Math.max(insets.top, theme.spacing.lg) + theme.spacing.sm,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.lg,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <IconButton
            name="chevronDown"
            variant="ghost"
            accessibilityLabel="Collapse chat"
            onPress={() => navigation.goBack()}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="title">Arnold</Text>
            <BetaBadge />
          </View>
        </View>
        <IconButton
          name="moreVertical"
          variant="ghost"
          accessibilityLabel="Chat options"
          onPress={() => setOptionsSheetOpen(true)}
        />
      </View>

      <KeyboardAvoider>
        {isLoading ? (
          <LoadingState />
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            ref={scrollRef}
            contentContainerStyle={{
              padding: theme.spacing.lg,
              gap: theme.spacing.sm,
            }}
            onContentSizeChange={() =>
              scrollRef.current?.scrollToEnd({ animated: true })
            }
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {messages?.length === 0 &&
            !pendingUserText &&
            !pendingUserPhotoUri ? (
              <EmptyState
                icon="messageCircle"
                title="Ask Arnold"
                description={
                  featureFlags.nutritionTracking
                    ? 'Training, recovery, or nutrition — ask anything. Snap a photo of a meal to log it.'
                    : 'Training, recovery, or nutrition — ask anything.'
                }
              />
            ) : null}

            {messages?.map(m => (
              <ChatBubble
                key={m.id}
                role={m.role}
                content={m.content}
                photoUrl={m.photo_path ? signedPhotoUrls?.[m.photo_path] : null}
                foodLogEntryId={m.food_log_entry_id}
              />
            ))}

            {pendingUserText || pendingUserPhotoUri ? (
              <ChatBubble
                role="user"
                content={pendingUserText}
                photoUrl={pendingUserPhotoUri}
              />
            ) : null}
            {uploadingPhoto ? (
              <ActivityIndicator color={theme.colors.accent.primary} />
            ) : null}
            {streamingBuffer ? (
              <ChatBubble role="assistant" content={streamingBuffer} />
            ) : null}
            {sending && !streamingBuffer && !uploadingPhoto ? (
              <ActivityIndicator color={theme.colors.accent.primary} />
            ) : null}
            {error ? (
              <Text
                variant="caption"
                style={{ color: theme.colors.semantic.danger }}
              >
                {error}
              </Text>
            ) : null}
          </ScrollView>
        )}

        {!isPremium ? (
          <Text
            variant="caption"
            color="secondary"
            style={{ textAlign: 'center', paddingHorizontal: theme.spacing.lg }}
          >
            {atFreeLimit
              ? "You've used all your free messages this month — upgrade for unlimited access to Arnold"
              : `${messagesUsedThisMonth} of ${FREE_MESSAGES_PER_MONTH} free messages used this month`}
          </Text>
        ) : null}

        {attachedPhoto ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
              paddingHorizontal: theme.spacing.lg,
              paddingBottom: theme.spacing.sm,
            }}
          >
            <Image
              source={{ uri: attachedPhoto.uri }}
              style={{ width: 48, height: 48, borderRadius: theme.radii.md }}
            />
            <Text variant="caption" color="secondary" style={{ flex: 1 }}>
              Add a note below (e.g. "log this for breakfast") or just hit Send.
            </Text>
            <IconButton
              name="x"
              variant="ghost"
              accessibilityLabel="Remove photo"
              onPress={() => setAttachedPhoto(null)}
            />
          </View>
        ) : null}

        <View
          style={{
            flexDirection: 'row',
            gap: theme.spacing.sm,
            padding: theme.spacing.lg,
            alignItems: 'flex-end',
          }}
        >
          {featureFlags.nutritionTracking ? (
            <IconButton
              name="camera"
              variant="ghost"
              accessibilityLabel="Attach a food photo"
              onPress={() => setAttachSheetOpen(true)}
              disabled={sending || atFreeLimit}
            />
          ) : null}
          <View style={{ flex: 1 }}>
            <TextField
              ref={inputRef}
              value={input}
              onChangeText={setInput}
              placeholder={
                atFreeLimit
                  ? 'Upgrade to keep chatting…'
                  : attachedPhoto
                  ? 'Add a note (optional)…'
                  : 'Ask Arnold...'
              }
              multiline
              editable={!sending}
            />
          </View>
          <Button
            label={atFreeLimit ? 'Upgrade' : 'Send'}
            onPress={onSend}
            disabled={(!input.trim() && !attachedPhoto) || sending}
            loading={sending}
            gradientColors={atFreeLimit ? theme.gradients.premium : undefined}
          />
        </View>
      </KeyboardAvoider>

      <BottomSheet
        visible={optionsSheetOpen}
        onClose={() => setOptionsSheetOpen(false)}
      >
        <ListRow title="Clear Chat" icon="trash" onPress={onClearChat} />
      </BottomSheet>

      <BottomSheet
        visible={attachSheetOpen}
        onClose={() => setAttachSheetOpen(false)}
        onDismissed={onAttachSheetDismissed}
      >
        <ListRow title="Take Photo" icon="camera" onPress={onTakePhoto} />
        <ListRow
          title="Choose from Library"
          icon="image"
          onPress={onChooseFromLibrary}
        />
      </BottomSheet>
    </SafeAreaView>
  );
}

function TextBubble({
  theme,
  isUser,
  content,
}: {
  theme: Theme;
  isUser: boolean;
  content: string;
}) {
  return (
    <Card
      variant={isUser ? 'flat' : 'subtle'}
      style={{
        maxWidth: '85%',
        backgroundColor: isUser
          ? theme.colors.accent.primary
          : theme.colors.bg.surface,
        borderWidth: 0,
        borderRadius: theme.radii.lg,
        [isUser ? 'borderBottomRightRadius' : 'borderBottomLeftRadius']:
          theme.radii.xs,
      }}
    >
      <Text
        variant="body"
        style={{
          color: isUser
            ? theme.colors.text.onAccent
            : theme.colors.text.primary,
        }}
      >
        {content}
      </Text>
    </Card>
  );
}

type ChatBubbleProps = {
  role: ChatRole;
  content?: string | null;
  /** A resolved (signed, or local file://) URL for a photo attached to this
   * message — null/undefined renders as a plain text bubble instead. */
  photoUrl?: string | null;
  /** Set on the assistant reply that produced a food estimate (see
   * chat-coach's log_food_estimate tool) — renders FoodEstimateCard instead
   * of any of the above when present. */
  foodLogEntryId?: string | null;
};

/**
 * Branches on what a message actually carries rather than just `role`:
 * food_log_entry_id -> FoodEstimateCard, photo_path -> a thumbnail (plus an
 * optional caption bubble underneath), otherwise the plain text bubble this
 * screen always rendered before Phase 2.
 */
/** "Arnold" for the assistant, "You" for the athlete — shown above every
 * message regardless of what it carries (text, photo, food estimate), so
 * who-said-what is never ambiguous. */
function SenderLabel({ theme, isUser }: { theme: Theme; isUser: boolean }) {
  return (
    <Text
      variant="caption"
      color="secondary"
      style={{
        marginBottom: theme.spacing.xxs,
        marginHorizontal: theme.spacing.xxs,
      }}
    >
      {isUser ? 'You' : 'Arnold'}
    </Text>
  );
}

function ChatBubble({
  role,
  content,
  photoUrl,
  foodLogEntryId,
}: ChatBubbleProps) {
  const theme = useTheme();
  const isUser = role === 'user';

  if (foodLogEntryId) {
    return (
      <View
        style={{
          alignItems: isUser ? 'flex-end' : 'flex-start',
          // Caps the card the same way TextBubble caps at 85% — without a
          // width limit here, the confirm row's icon + Edit + Looks good
          // buttons (no flex-wrap) can add up to more than the screen width
          // on narrower devices or larger system font sizes, pushing "Looks
          // good" past the right edge where the vertical ScrollView clips it.
          maxWidth: '85%',
        }}
      >
        <SenderLabel theme={theme} isUser={isUser} />
        <FoodEstimateCard foodLogEntryId={foodLogEntryId} />
      </View>
    );
  }

  if (photoUrl) {
    return (
      <View
        style={{
          alignItems: isUser ? 'flex-end' : 'flex-start',
          gap: theme.spacing.xs,
        }}
      >
        <SenderLabel theme={theme} isUser={isUser} />
        <Image
          testID="chat-photo-thumbnail"
          source={{ uri: photoUrl }}
          style={{ width: 200, height: 150, borderRadius: theme.radii.lg }}
          resizeMode="cover"
        />
        {content ? (
          <TextBubble theme={theme} isUser={isUser} content={content} />
        ) : null}
      </View>
    );
  }

  if (!content) return null;

  return (
    <View style={{ alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      <SenderLabel theme={theme} isUser={isUser} />
      <TextBubble theme={theme} isUser={isUser} content={content} />
    </View>
  );
}
