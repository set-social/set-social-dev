import React from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Header,
  ListRow,
  Button,
  EmptyState,
  LoadingState,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import {
  useBlockedUsers,
  useUnblockUser,
} from '../../services/api/queries/community';

export function BlockedUsersScreen() {
  const theme = useTheme();
  const userId = useAuthStore(state => state.userId);
  const { data: blockedUsers, isLoading } = useBlockedUsers(userId);
  const unblockUser = useUnblockUser(userId);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.bg.base }}
      edges={['top']}
    >
      <Header title="Blocked Users" />

      {isLoading ? (
        <LoadingState />
      ) : blockedUsers?.length === 0 ? (
        <EmptyState
          icon="circleAlert"
          title="No blocked users"
          description="You haven't blocked anyone."
        />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            padding: theme.spacing.lg,
            paddingTop: 0,
            gap: theme.spacing.xs,
          }}
        >
          {blockedUsers?.map((profile, index) => (
            <ListRow
              key={profile.id}
              title={profile.display_name ?? 'Athlete'}
              trailing={
                <Button
                  label="Unblock"
                  variant="secondary"
                  size="sm"
                  loading={unblockUser.isPending}
                  onPress={() => unblockUser.mutate(profile.id)}
                />
              }
              style={
                index > 0
                  ? {
                      borderTopWidth: 1,
                      borderTopColor: theme.colors.border.subtle,
                    }
                  : undefined
              }
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
