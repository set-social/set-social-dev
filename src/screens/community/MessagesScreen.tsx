import React, { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import {
  Header,
  Text,
  Card,
  ListRow,
  Avatar,
  EmptyState,
  LoadingState,
  SegmentedControl,
  Button,
  IconButton,
  BottomSheet,
  ReportBlockSheet,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import {
  useConversations,
  useIncomingDmRequests,
  useOutgoingDmRequests,
  useRespondToConversation,
  useDeleteConversation,
  type ConversationSummary,
} from '../../services/api/queries/directMessages';
import { getErrorMessage } from '../../utils/errors';
import type { CommunityStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<CommunityStackParamList>;
type Tab = 'messages' | 'requests';

const rowBorderStyle = (theme: ReturnType<typeof useTheme>) => ({
  borderTopWidth: 1,
  borderTopColor: theme.colors.border.subtle,
});

type ConversationRowProps = {
  conversation: ConversationSummary;
  isFirst: boolean;
  onNavigate: (conversationId: string) => void;
  onOptions: (conversation: ConversationSummary) => void;
};

// Not a FlatList — conversations/requests are grouped "settings list"-style
// Card sections (bordered rows sharing one Card), not an open-ended feed;
// realistically a handful to a few dozen rows, not hundreds. Still memoized
// + stable-callback'd (same pattern as FeedPostCard/WorkoutExerciseRow)
// since that's cheap and correct regardless of list length, but virtualizing
// this would add ListHeaderComponent/Card-section complexity for no real
// windowing benefit at this scale.
const ConversationRow = React.memo(function ConversationRow({
  conversation,
  isFirst,
  onNavigate,
  onOptions,
}: ConversationRowProps) {
  const theme = useTheme();
  return (
    <ListRow
      title={conversation.otherParticipant?.display_name ?? 'Athlete'}
      subtitle={format(new Date(conversation.last_message_at), 'MMM d, h:mm a')}
      leading={
        <Avatar
          uri={conversation.otherParticipant?.avatar_url}
          focalX={conversation.otherParticipant?.avatar_focal_x}
          focalY={conversation.otherParticipant?.avatar_focal_y}
          size={40}
        />
      }
      trailing={
        <IconButton
          name="moreVertical"
          variant="ghost"
          accessibilityLabel="Conversation options"
          onPress={() => onOptions(conversation)}
        />
      }
      onPress={() => onNavigate(conversation.id)}
      style={isFirst ? undefined : rowBorderStyle(theme)}
    />
  );
});

type IncomingRequestRowProps = {
  conversation: ConversationSummary;
  isFirst: boolean;
  respondPending: boolean;
  onNavigate: (conversationId: string) => void;
  onAccept: (conversationId: string) => void;
  onDecline: (conversationId: string) => void;
};

const IncomingRequestRow = React.memo(function IncomingRequestRow({
  conversation,
  isFirst,
  respondPending,
  onNavigate,
  onAccept,
  onDecline,
}: IncomingRequestRowProps) {
  const theme = useTheme();
  return (
    <ListRow
      title={conversation.otherParticipant?.display_name ?? 'Athlete'}
      leading={
        <Avatar
          uri={conversation.otherParticipant?.avatar_url}
          focalX={conversation.otherParticipant?.avatar_focal_x}
          focalY={conversation.otherParticipant?.avatar_focal_y}
          size={40}
        />
      }
      onPress={() => onNavigate(conversation.id)}
      trailing={
        <View style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
          <Button
            label="Accept"
            size="sm"
            onPress={() => onAccept(conversation.id)}
            loading={respondPending}
          />
          <Button
            label="Decline"
            size="sm"
            variant="secondary"
            onPress={() => onDecline(conversation.id)}
            loading={respondPending}
          />
        </View>
      }
      style={isFirst ? undefined : rowBorderStyle(theme)}
    />
  );
});

type OutgoingRequestRowProps = {
  conversation: ConversationSummary;
  isFirst: boolean;
};

const OutgoingRequestRow = React.memo(function OutgoingRequestRow({
  conversation,
  isFirst,
}: OutgoingRequestRowProps) {
  const theme = useTheme();
  return (
    <ListRow
      title={conversation.otherParticipant?.display_name ?? 'Athlete'}
      subtitle="Pending"
      leading={
        <Avatar
          uri={conversation.otherParticipant?.avatar_url}
          focalX={conversation.otherParticipant?.avatar_focal_x}
          focalY={conversation.otherParticipant?.avatar_focal_y}
          size={40}
        />
      }
      style={isFirst ? undefined : rowBorderStyle(theme)}
    />
  );
});

export function MessagesScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const navigation = useNavigation<Nav>();
  const userId = useAuthStore(state => state.userId);
  const [tab, setTab] = useState<Tab>('messages');
  const [moderatingConversation, setModeratingConversation] =
    useState<ConversationSummary | null>(null);
  const [conversationOptionsFor, setConversationOptionsFor] =
    useState<ConversationSummary | null>(null);

  const {
    data: conversations,
    isLoading: conversationsLoading,
    refetch: refetchConversations,
  } = useConversations(userId);
  const {
    data: incoming,
    isLoading: incomingLoading,
    refetch: refetchIncoming,
  } = useIncomingDmRequests(userId);
  const { data: outgoing, refetch: refetchOutgoing } =
    useOutgoingDmRequests(userId);
  const respond = useRespondToConversation();
  const deleteConversation = useDeleteConversation();

  const onDeleteConversation = (conversation: ConversationSummary) => {
    setConversationOptionsFor(null);
    if (!userId) return;
    const name = conversation.otherParticipant?.display_name ?? 'they';
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
              { conversationId: conversation.id, userId },
              {
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

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetchConversations(),
        refetchIncoming(),
        refetchOutgoing(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchConversations, refetchIncoming, refetchOutgoing]);

  const requestCount = (incoming?.length ?? 0) + (outgoing?.length ?? 0);

  // Stable references passed into the memoized row components above — an
  // inline arrow at each call site would be recreated every render,
  // defeating that memoization.
  const onNavigateConversation = useCallback(
    (conversationId: string) =>
      navigation.navigate('Conversation', { conversationId }),
    [navigation],
  );
  const onAcceptRequest = useCallback(
    (conversationId: string) => {
      if (!userId) return;
      respond.mutate({ id: conversationId, userId, status: 'accepted' });
    },
    [userId, respond],
  );
  const onDeclineRequest = useCallback(
    (conversationId: string) => {
      if (!userId) return;
      respond.mutate({ id: conversationId, userId, status: 'declined' });
    },
    [userId, respond],
  );

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg.base }}
      edges={['top']}
    >
      <Header title="Messages" />
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.sm,
        }}
      >
        <SegmentedControl<Tab>
          options={[
            { value: 'messages', label: 'Messages' },
            {
              value: 'requests',
              label:
                requestCount > 0 ? `Requests (${requestCount})` : 'Requests',
            },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingTop: 0,
          paddingBottom: theme.spacing.lg + tabBarHeight,
          gap: theme.spacing.lg,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent.primary}
          />
        }
      >
        {tab === 'messages' ? (
          conversationsLoading ? (
            <LoadingState fill={false} />
          ) : !conversations || conversations.length === 0 ? (
            <EmptyState
              icon="messageCircle"
              title="No messages yet"
              description="Start a conversation from someone's profile."
            />
          ) : (
            <Card variant="elevated" style={{ gap: 0 }}>
              {conversations.map((c, index) => (
                <ConversationRow
                  key={c.id}
                  conversation={c}
                  isFirst={index === 0}
                  onNavigate={onNavigateConversation}
                  onOptions={setConversationOptionsFor}
                />
              ))}
            </Card>
          )
        ) : incomingLoading ? (
          <LoadingState fill={false} />
        ) : requestCount === 0 ? (
          <EmptyState
            icon="messageCircle"
            title="No requests"
            description="Message requests from people you haven't accepted yet will show up here."
          />
        ) : (
          <>
            {incoming && incoming.length > 0 ? (
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="label" color="secondary">
                  REQUESTS
                </Text>
                <Card variant="elevated" style={{ gap: 0 }}>
                  {incoming.map((c, index) => (
                    <IncomingRequestRow
                      key={c.id}
                      conversation={c}
                      isFirst={index === 0}
                      respondPending={respond.isPending}
                      onNavigate={onNavigateConversation}
                      onAccept={onAcceptRequest}
                      onDecline={onDeclineRequest}
                    />
                  ))}
                </Card>
              </View>
            ) : null}

            {outgoing && outgoing.length > 0 ? (
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="label" color="secondary">
                  SENT
                </Text>
                <Card variant="elevated" style={{ gap: 0 }}>
                  {outgoing.map((c, index) => (
                    <OutgoingRequestRow key={c.id} conversation={c} isFirst={index === 0} />
                  ))}
                </Card>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      <BottomSheet
        visible={conversationOptionsFor != null}
        onClose={() => setConversationOptionsFor(null)}
        title="Conversation Options"
      >
        <View>
          <ListRow
            title="Delete Conversation"
            icon="trash"
            onPress={() =>
              conversationOptionsFor &&
              onDeleteConversation(conversationOptionsFor)
            }
          />
          <ListRow
            title="Report or Block"
            icon="flag"
            onPress={() => {
              const conversation = conversationOptionsFor;
              setConversationOptionsFor(null);
              setModeratingConversation(conversation);
            }}
            style={{
              borderTopWidth: 1,
              borderTopColor: theme.colors.border.subtle,
            }}
          />
        </View>
      </BottomSheet>

      <ReportBlockSheet
        visible={moderatingConversation != null}
        onClose={() => setModeratingConversation(null)}
        currentUserId={userId}
        targetType="conversation"
        targetId={moderatingConversation?.id ?? ''}
        reportedUserId={moderatingConversation?.otherParticipant?.id ?? ''}
        reportedUserName={
          moderatingConversation?.otherParticipant?.display_name ?? undefined
        }
      />
    </SafeAreaView>
  );
}
