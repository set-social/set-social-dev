import React from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Text,
  Card,
  Header,
  LoadingState,
  Icon,
  type IconName,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import {
  useProfile,
  useUpdateProfile,
} from '../../services/api/queries/profiles';
import { featureFlags } from '../../config/featureFlags';
import type { ProfileStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<
  ProfileStackParamList,
  'NotificationSettings'
>;

function CategoryRow({
  icon,
  tint,
  title,
  subtitle,
  value,
  onChange,
  locked,
}: {
  icon: IconName;
  tint: string;
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (value: boolean) => void;
  locked?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
      }}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: theme.radii.sm,
          backgroundColor: `${tint}24`,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size="sm" color={tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="body">{title}</Text>
        <Text variant="caption" color="secondary">
          {subtitle}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={locked}
        trackColor={{
          false: theme.colors.border.default,
          true: theme.colors.accent.primary,
        }}
        thumbColor={theme.colors.text.onAccent}
        accessibilityLabel={title}
      />
    </View>
  );
}

export function NotificationSettingsScreen(_props: Props) {
  const theme = useTheme();
  const userId = useAuthStore(state => state.userId);
  const { data: profile, isLoading } = useProfile(userId);
  const updateProfile = useUpdateProfile(userId);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <Header title="Notifications" />

      {isLoading ? (
        <LoadingState />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            padding: theme.spacing.lg,
            paddingTop: 0,
            gap: theme.spacing.xl,
          }}
        >
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" color="secondary">
              PUSH NOTIFICATIONS
            </Text>
            <Card variant="elevated" style={{ gap: 0 }}>
              <CategoryRow
                icon="messageCircle"
                tint={theme.colors.accent.blue}
                title="Messages"
                subtitle="Time Sensitive · always on"
                value
                onChange={() => {}}
                locked
              />
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border.subtle,
                }}
              >
                <CategoryRow
                  icon="users"
                  tint={theme.colors.accent.blue}
                  title="Friends"
                  subtitle="Requests & accepts"
                  value={profile?.push_friends_enabled ?? true}
                  onChange={value =>
                    updateProfile.mutate({ push_friends_enabled: value })
                  }
                />
              </View>
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border.subtle,
                }}
              >
                <CategoryRow
                  icon="dumbbell"
                  tint={theme.colors.accent.teal}
                  title="Spot Requests"
                  subtitle="A nearby athlete at your gym needs a spot"
                  value={profile?.push_spot_requests_enabled ?? true}
                  onChange={value =>
                    updateProfile.mutate({ push_spot_requests_enabled: value })
                  }
                />
              </View>
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border.subtle,
                }}
              >
                <CategoryRow
                  icon="heart"
                  tint={theme.colors.accent.orange}
                  title="Photo activity"
                  subtitle="Likes & comments"
                  value={profile?.push_activity_enabled ?? true}
                  onChange={value =>
                    updateProfile.mutate({ push_activity_enabled: value })
                  }
                />
              </View>
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border.subtle,
                }}
              >
                <CategoryRow
                  icon="zap"
                  tint={theme.colors.accent.purple}
                  title="Arnold"
                  subtitle="New programs & insights"
                  value={profile?.push_ai_coach_enabled ?? true}
                  onChange={value =>
                    updateProfile.mutate({ push_ai_coach_enabled: value })
                  }
                />
              </View>
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border.subtle,
                }}
              >
                <CategoryRow
                  icon="sun"
                  tint={theme.colors.accent.orange}
                  title="Morning brief"
                  subtitle="Today's plan, streak & recovery, once a day"
                  value={profile?.push_morning_brief_enabled ?? true}
                  onChange={value =>
                    updateProfile.mutate({ push_morning_brief_enabled: value })
                  }
                />
              </View>
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border.subtle,
                }}
              >
                <CategoryRow
                  icon="trendingUp"
                  tint={theme.colors.accent.blue}
                  title="Personal records"
                  subtitle="The moment you hit a new PR"
                  value={profile?.push_pr_alerts_enabled ?? true}
                  onChange={value =>
                    updateProfile.mutate({ push_pr_alerts_enabled: value })
                  }
                />
              </View>
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border.subtle,
                }}
              >
                <CategoryRow
                  icon="trendingUp"
                  tint={theme.colors.accent.blue}
                  title="Friends' PRs"
                  subtitle="When a friend hits a new PR"
                  value={profile?.push_friend_prs_enabled ?? true}
                  onChange={value =>
                    updateProfile.mutate({ push_friend_prs_enabled: value })
                  }
                />
              </View>
              {featureFlags.nutritionTracking ? (
                <View
                  style={{
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.border.subtle,
                  }}
                >
                  <CategoryRow
                    icon="flame"
                    tint={theme.colors.accent.orange}
                    title="Meal reminders"
                    subtitle="Nudges to log a meal you haven't logged yet"
                    value={
                      (profile?.push_ai_coach_enabled ?? true) &&
                      (profile?.push_meal_reminders_enabled ?? true)
                    }
                    onChange={value =>
                      updateProfile.mutate({
                        push_meal_reminders_enabled: value,
                      })
                    }
                    locked={!(profile?.push_ai_coach_enabled ?? true)}
                  />
                </View>
              ) : null}
            </Card>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
