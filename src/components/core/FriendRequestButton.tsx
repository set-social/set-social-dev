import React from 'react';
import { Alert, View } from 'react-native';
import { Button } from './Button';
import type { FriendRequestState } from '../../services/api/queries/community';

type FriendRequestButtonProps = {
  state: FriendRequestState;
  displayName: string;
  onSend: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onRemove: () => void;
  loading?: boolean;
  size?: 'sm' | 'md';
};

/**
 * The one friend-relationship action control, shared by LeaderboardScreen's
 * search results and FriendProfileScreen — keeps the request/accept/remove
 * state machine in one place rather than duplicating it per screen.
 */
export function FriendRequestButton({
  state,
  displayName,
  onSend,
  onAccept,
  onDecline,
  onRemove,
  loading,
  size = 'sm',
}: FriendRequestButtonProps) {
  const confirmRemove = () => {
    const isFriends = state === 'friends';
    Alert.alert(
      isFriends ? 'Remove friend?' : 'Cancel request?',
      isFriends
        ? `${displayName} will be removed from your friends.`
        : `Your friend request to ${displayName} will be cancelled.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: isFriends ? 'Remove' : 'Cancel Request', style: 'destructive', onPress: onRemove },
      ],
    );
  };

  if (state === 'incoming') {
    return (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button label="Decline" variant="secondary" size={size} onPress={onDecline} disabled={loading} />
        <Button label="Accept" variant="primary" size={size} onPress={onAccept} loading={loading} />
      </View>
    );
  }

  if (state === 'friends') {
    return <Button label="Friends" variant="secondary" size={size} onPress={confirmRemove} disabled={loading} />;
  }

  if (state === 'outgoing') {
    return <Button label="Requested" variant="secondary" size={size} onPress={confirmRemove} disabled={loading} />;
  }

  return <Button label="Add Friend" variant="primary" size={size} onPress={onSend} loading={loading} />;
}
