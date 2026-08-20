import React, { useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Button, SetSocialIcon, BottomSheet } from '../core';
import { useUpdateProfile } from '../../services/api/queries/profiles';
import { requestPushPermission } from '../../services/push/pushNotifications';

type NotificationPrimerSheetProps = {
  visible: boolean;
  userId: string | null;
  onClose: () => void;
};

/**
 * The one-time soft ask from the reviewed design spec — shown before the OS
 * permission dialog, since a cold system prompt with no context converts far
 * worse than one the athlete has already said yes to once. Either button
 * marks push_primer_shown_at so it never shows again; only "Turn on
 * notifications" also fires the real OS prompt via requestPushPermission.
 */
export function NotificationPrimerSheet({ visible, userId, onClose }: NotificationPrimerSheetProps) {
  const theme = useTheme();
  const updateProfile = useUpdateProfile(userId);
  const [requesting, setRequesting] = useState(false);

  const dismiss = () => {
    updateProfile.mutate({ push_primer_shown_at: new Date().toISOString() });
    onClose();
  };

  const onEnable = async () => {
    setRequesting(true);
    try {
      await requestPushPermission();
    } finally {
      setRequesting(false);
      dismiss();
    }
  };

  return (
    <BottomSheet visible={visible} onClose={dismiss}>
      <View style={{ alignItems: 'flex-start', gap: theme.spacing.lg }}>
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: theme.radii.lg,
            backgroundColor: theme.colors.bg.surfaceElevated,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SetSocialIcon size={28} />
        </View>

        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="title">Don't miss a PR</Text>
          <Text variant="body" color="secondary">
            Turn on notifications to hear about new messages, friend requests, and reactions to your posts the
            moment they happen.
          </Text>
        </View>

        <View style={{ width: '100%', gap: theme.spacing.sm }}>
          <Button label="Turn on notifications" onPress={onEnable} loading={requesting} style={{ width: '100%' }} />
          <Button label="Not now" variant="ghost" onPress={dismiss} style={{ width: '100%' }} />
        </View>
      </View>
    </BottomSheet>
  );
}
