import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { launchImageLibrary } from 'react-native-image-picker';
import { format } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { TAB_BAR_FLOAT_FOOTPRINT } from '../../navigation/MainTabs';
import {
  Header,
  Text,
  Icon,
  IconButton,
  TextField,
  LoadingState,
  Avatar,
  ReportBlockSheet,
  BottomSheet,
  ListRow,
  KeyboardAvoider,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import {
  useConversation,
  useMessages,
  useSendMessage,
  useToggleMessageLike,
  useDeleteMessage,
  useDeleteConversation,
  useConversationRealtime,
  useSignedDmPhotoUrls,
} from '../../services/api/queries/directMessages';
import { getErrorMessage } from '../../utils/errors';
import type { CommunityStackParamList } from '../../navigation/types';

type Route = RouteProp<CommunityStackParamList, 'Conversation'>;
type Nav = NativeStackNavigationProp<CommunityStackParamList>;

type PendingPhoto = { uri: string; contentType: string };

export function ConversationScreen() {
  const theme = useTheme();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const userId = useAuthStore(state => state.userId);
  const scrollRef = useRef<ScrollView>(null);

  const { data: conversation } = useConversation(params.conversationId, userId);
  const {
    data: messages,
    isLoading,
    refetch: refetchMessages,
  } = useMessages(params.conversationId, userId);
  const sendMessage = useSendMessage();
  const toggleLike = useToggleMessageLike();
  const deleteMessage = useDeleteMessage();
  const deleteConversation = useDeleteConversation();
  useConversationRealtime(params.conversationId);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetchMessages();
    } finally {
      setRefreshing(false);
    }
  }, [refetchMessages]);

  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<PendingPhoto | null>(null);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const photoPaths = useMemo(
    () =>
      (messages ?? [])
        .map(m => m.photo_path)
        .filter((p): p is string => p != null),
    [messages],
  );
  const { data: signedUrls } = useSignedDmPhotoUrls(photoPaths);

  const onPickPhoto = async () => {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
    });
    if (result.didCancel) return;
    if (result.errorCode) {
      Alert.alert(
        'Could not open photo library',
        result.errorMessage ?? 'Please try again.',
      );
      return;
    }
    const asset = result.assets?.[0];
    if (!asset?.uri) return;
    setPhoto({ uri: asset.uri, contentType: asset.type ?? 'image/jpeg' });
  };

  const onSend = async () => {
    if (!userId || (!body.trim() && !photo)) return;
    const outgoingBody = body.trim() || null;
    const outgoingPhoto = photo;
    setBody('');
    setPhoto(null);
    try {
      await sendMessage.mutateAsync({
        conversationId: params.conversationId,
        senderId: userId,
        body: outgoingBody,
        photo: outgoingPhoto,
      });
    } catch (err) {
      Alert.alert(
        'Could not send message',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  };

  const onUnsendMessage = (messageId: string, photoPath: string | null) => {
    if (!userId) return;
    Alert.alert(
      'Unsend this message?',
      "It'll be removed for both of you — this can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unsend',
          style: 'destructive',
          onPress: () =>
            deleteMessage.mutate(
              {
                messageId,
                conversationId: params.conversationId,
                userId,
                photoPath,
              },
              {
                onError: err =>
                  Alert.alert(
                    'Could not unsend message',
                    getErrorMessage(err, 'Please try again.'),
                  ),
              },
            ),
        },
      ],
    );
  };

  const onDeleteConversation = () => {
    setOptionsOpen(false);
    if (!userId) return;
    const name = conversation?.otherParticipant?.display_name ?? 'they';
    Alert.alert(
      'Delete this conversation?',
      `It'll be removed from your messages, but ${name} will keep their copy — it'll come back if they message you again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deleteConversation.mutate(
              { conversationId: params.conversationId, userId },
              {
                onSuccess: () => navigation.goBack(),
                onError: err =>
                  Alert.alert(
                    'Could not delete conversation',
                    getErrorMessage(err, 'Please try again.'),
                  ),
              },
            ),
        },
      ],
    );
  };

  const isPendingForMe =
    conversation?.status === 'pending' && conversation.recipient_id === userId;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <Header
        title={conversation?.otherParticipant?.display_name ?? 'Messages'}
        right={
          conversation ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.sm,
              }}
            >
              <Avatar
                uri={conversation.otherParticipant?.avatar_url}
                focalX={conversation.otherParticipant?.avatar_focal_x}
                focalY={conversation.otherParticipant?.avatar_focal_y}
                size={32}
                onPress={() =>
                  conversation.otherParticipant &&
                  navigation.navigate('FriendProfile', {
                    userId: conversation.otherParticipant.id,
                  })
                }
              />
              <IconButton
                name="moreVertical"
                variant="ghost"
                accessibilityLabel="Conversation options"
                onPress={() => setOptionsOpen(true)}
              />
            </View>
          ) : undefined
        }
      />
      <KeyboardAvoider>
        {isLoading ? (
          <LoadingState />
        ) : (
          <ScrollView
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
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.colors.accent.primary}
              />
            }
          >
            {(messages ?? []).map(message => {
              const isMine = message.sender_id === userId;
              const share = message.workout_shares;
              return (
                <View
                  key={message.id}
                  style={{ alignItems: isMine ? 'flex-end' : 'flex-start' }}
                >
                  {share ? (
                    <Pressable
                      onPress={() =>
                        navigation.navigate('SharedWorkoutReview', {
                          shareId: share.id,
                        })
                      }
                      style={{ maxWidth: '80%' }}
                    >
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: theme.spacing.sm,
                          backgroundColor: isMine
                            ? theme.colors.accent.primary
                            : theme.colors.bg.surface,
                          borderRadius: theme.radii.md,
                          padding: theme.spacing.sm,
                        }}
                      >
                        <Icon
                          name="dumbbell"
                          size="sm"
                          color={
                            isMine
                              ? theme.colors.text.onAccent
                              : theme.colors.accent.primary
                          }
                        />
                        <View style={{ flex: 1 }}>
                          <Text
                            variant="body"
                            style={{
                              fontWeight: '700',
                              color: isMine
                                ? theme.colors.text.onAccent
                                : theme.colors.text.primary,
                            }}
                          >
                            {share.title}
                          </Text>
                          <Text
                            variant="caption"
                            style={{
                              color: isMine
                                ? theme.colors.text.onAccent
                                : theme.colors.text.secondary,
                              opacity: 0.75,
                            }}
                          >
                            {share.share_type === 'weekly_plan'
                              ? '7-day plan'
                              : 'Workout'}
                            {share.status === 'accepted'
                              ? ' · Added to plan'
                              : share.status === 'declined'
                              ? ' · Declined'
                              : ' · Tap to review'}
                          </Text>
                        </View>
                        <Icon
                          name="chevronRight"
                          size="sm"
                          color={
                            isMine
                              ? theme.colors.text.onAccent
                              : theme.colors.text.tertiary
                          }
                        />
                      </View>
                    </Pressable>
                  ) : (
                    <View
                      style={{
                        maxWidth: '80%',
                        backgroundColor: isMine
                          ? theme.colors.accent.primary
                          : theme.colors.bg.surface,
                        borderRadius: theme.radii.md,
                        padding: theme.spacing.sm,
                        gap: theme.spacing.xs,
                      }}
                    >
                      {message.photo_path &&
                      signedUrls?.[message.photo_path] ? (
                        <Image
                          source={{ uri: signedUrls[message.photo_path] }}
                          style={{
                            width: 200,
                            height: 200,
                            borderRadius: theme.radii.sm,
                          }}
                          resizeMode="cover"
                        />
                      ) : null}
                      {message.body ? (
                        <Text
                          variant="body"
                          style={{
                            color: isMine
                              ? theme.colors.text.onAccent
                              : theme.colors.text.primary,
                          }}
                        >
                          {message.body}
                        </Text>
                      ) : null}
                    </View>
                  )}
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Pressable
                      onPress={() =>
                        userId &&
                        toggleLike.mutate({
                          messageId: message.id,
                          conversationId: params.conversationId,
                          userId,
                          currentlyLiked: message.likedByMe,
                        })
                      }
                      accessibilityLabel={
                        message.likedByMe ? 'Unlike message' : 'Like message'
                      }
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 2,
                        paddingTop: 2,
                        paddingHorizontal: 4,
                      }}
                    >
                      <Icon
                        name="heart"
                        size={12}
                        color={
                          message.likedByMe
                            ? theme.colors.semantic.danger
                            : theme.colors.text.tertiary
                        }
                      />
                      {message.likeCount > 0 ? (
                        <Text variant="caption" color="tertiary">
                          {message.likeCount}
                        </Text>
                      ) : null}
                      <Text
                        variant="caption"
                        color="tertiary"
                        style={{ marginLeft: 4 }}
                      >
                        {format(new Date(message.created_at), 'h:mm a')}
                      </Text>
                    </Pressable>
                    {isMine ? (
                      <IconButton
                        name="trash"
                        variant="ghost"
                        size={20}
                        accessibilityLabel="Unsend message"
                        onPress={() =>
                          onUnsendMessage(message.id, message.photo_path)
                        }
                      />
                    ) : null}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}

        {isPendingForMe ? (
          <View
            style={{
              paddingHorizontal: theme.spacing.lg,
              paddingBottom: theme.spacing.sm,
            }}
          >
            <Text variant="caption" color="secondary">
              {conversation?.otherParticipant?.display_name ?? 'This athlete'}{' '}
              isn't in your messages yet — replying will move them there.
            </Text>
          </View>
        ) : null}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            padding: theme.spacing.lg,
            paddingBottom: theme.spacing.lg + TAB_BAR_FLOAT_FOOTPRINT,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border.subtle,
          }}
        >
          <IconButton
            name="camera"
            variant="ghost"
            accessibilityLabel="Attach a photo"
            onPress={onPickPhoto}
          />
          <View style={{ flex: 1 }}>
            <TextField
              value={body}
              onChangeText={setBody}
              placeholder={photo ? 'Add a caption (optional)' : 'Message'}
            />
          </View>
          <IconButton
            name="chevronRight"
            variant="filled"
            accessibilityLabel="Send"
            onPress={onSend}
            disabled={!body.trim() && !photo}
          />
        </View>
      </KeyboardAvoider>

      <BottomSheet
        visible={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        title="Conversation Options"
      >
        <View>
          <ListRow
            title="Delete Conversation"
            icon="trash"
            onPress={onDeleteConversation}
          />
          <ListRow
            title="Report or Block"
            icon="flag"
            onPress={() => {
              setOptionsOpen(false);
              setModerationOpen(true);
            }}
            style={{
              borderTopWidth: 1,
              borderTopColor: theme.colors.border.subtle,
            }}
          />
        </View>
      </BottomSheet>

      {conversation ? (
        <ReportBlockSheet
          visible={moderationOpen}
          onClose={() => setModerationOpen(false)}
          currentUserId={userId}
          targetType="conversation"
          targetId={params.conversationId}
          reportedUserId={conversation.otherParticipant?.id ?? ''}
          reportedUserName={
            conversation.otherParticipant?.display_name ?? undefined
          }
          onBlocked={() => navigation.goBack()}
        />
      ) : null}
    </SafeAreaView>
  );
}
