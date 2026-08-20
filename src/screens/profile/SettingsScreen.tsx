import React from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type {
  NativeStackScreenProps,
  NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Text,
  SegmentedControl,
  Header,
  ListRow,
  LoadingState,
  Card,
  Icon,
  Avatar,
  Button,
  ProBadge,
} from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import {
  useProfile,
  useUpdateProfile,
} from '../../services/api/queries/profiles';
import { useRestorePurchases } from '../../services/api/queries/purchases';
import {
  hasProEntitlement,
  REVENUECAT_ENABLED,
} from '../../services/purchases/revenueCat';
import { useAuth } from '../../hooks/useAuth';
import { useFocusModeStore } from '../../store/focusModeStore';
import { useRestTimerPreferenceStore } from '../../store/restTimerPreferenceStore';
import { useCoachingRecommendationsPreferenceStore } from '../../store/coachingRecommendationsPreferenceStore';
import { useThemePreferenceStore } from '../../store/themePreferenceStore';
import { getErrorMessage } from '../../utils/errors';
import type {
  ProfileStackParamList,
  RootStackParamList,
} from '../../navigation/types';
import type { NutritionGoal, UnitPreference } from '../../types/database';

type Props = NativeStackScreenProps<ProfileStackParamList, 'Settings'>;

const SUPPORT_EMAIL = 'support@setsocial.app';

const GOAL_OPTIONS: { value: NutritionGoal; label: string }[] = [
  { value: 'cut', label: 'Cut' },
  { value: 'maintain', label: 'Maintain' },
  { value: 'bulk', label: 'Bulk' },
];

/** One label + one card per section is the whole redesign — every group
 * below follows this exact shape instead of some getting a label+card
 * (Home, Workout) and others (Units) getting neither. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text variant="label" color="secondary">
      {children}
    </Text>
  );
}

/** Local copy of PrivacyScreen's toggle row — not shared/exported, same as
 * that screen's own copy isn't; this one is a display preference (Focus
 * Mode), not a friend-facing privacy flag, so it doesn't belong there. */
function SettingsToggleRow({
  title,
  description,
  value,
  onChange,
}: {
  title: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
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
      <View style={{ flex: 1 }}>
        <Text variant="body">{title}</Text>
        <Text variant="caption" color="secondary">
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
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

/** The store, not SetSocial, owns cancel/change-plan for a real purchase —
 * these are Apple's/Google's own documented "take me straight to my
 * subscriptions" deep links, not a page we control. iOS routes this through
 * to Settings > [Account] > Subscriptions; Android opens Play Store's
 * subscriptions list. */
const MANAGE_SUBSCRIPTION_URL = Platform.select({
  ios: 'https://apps.apple.com/account/subscriptions',
  android: 'https://play.google.com/store/account/subscriptions',
});

/** Linking.openURL rejects (rather than resolving false) when nothing can
 * handle the URL — no Mail account configured is the common case in the
 * Simulator — so this needs its own catch instead of relying on
 * canOpenURL's result alone; falls back to just surfacing the address. */
async function contactSupport() {
  try {
    await Linking.openURL(`mailto:${SUPPORT_EMAIL}`);
  } catch {
    Alert.alert('Email not set up', `Reach us directly at ${SUPPORT_EMAIL}.`);
  }
}

export function SettingsScreen({ navigation }: Props) {
  const theme = useTheme();
  const rootNavigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const userId = useAuthStore(state => state.userId);
  const { data: profile, isLoading } = useProfile(userId);
  const updateProfile = useUpdateProfile(userId);
  const restorePurchases = useRestorePurchases();
  const { signOut, loading: signingOut } = useAuth();
  const focusModeEnabled = useFocusModeStore(state => state.focusModeEnabled);
  const setFocusModeEnabled = useFocusModeStore(
    state => state.setFocusModeEnabled,
  );
  const restTimerEnabled = useRestTimerPreferenceStore(
    state => state.restTimerEnabled,
  );
  const setRestTimerEnabled = useRestTimerPreferenceStore(
    state => state.setRestTimerEnabled,
  );
  const recommendationsEnabled = useCoachingRecommendationsPreferenceStore(
    state => state.recommendationsEnabled,
  );
  const setRecommendationsEnabled = useCoachingRecommendationsPreferenceStore(
    state => state.setRecommendationsEnabled,
  );
  const colorScheme = useThemePreferenceStore(state => state.colorScheme);
  const setColorScheme = useThemePreferenceStore(
    state => state.setColorScheme,
  );

  const onPressPremiumBanner = async () => {
    if (!profile?.is_premium) {
      rootNavigation.navigate('Paywall');
      return;
    }
    if (!MANAGE_SUBSCRIPTION_URL) return;
    try {
      await Linking.openURL(MANAGE_SUBSCRIPTION_URL);
    } catch {
      Alert.alert(
        'Could not open subscription settings',
        Platform.OS === 'ios'
          ? 'Manage or cancel your subscription from Settings > your name > Subscriptions.'
          : 'Manage or cancel your subscription from the Play Store app > Payments & subscriptions.',
      );
    }
  };

  const onRestorePurchases = () => {
    restorePurchases.mutate(undefined, {
      onSuccess: customerInfo => {
        Alert.alert(
          hasProEntitlement(customerInfo) ? 'Restored' : 'Nothing to restore',
          hasProEntitlement(customerInfo)
            ? 'Your SetSocial Pro purchase has been restored.'
            : "We didn't find a previous purchase for this account.",
        );
      },
      onError: err =>
        Alert.alert(
          'Restore failed',
          getErrorMessage(err, 'Please try again.'),
        ),
    });
  };

  const setUnitPreference = (unit_preference: UnitPreference) => {
    updateProfile.mutate({ unit_preference });
  };

  const setNutritionGoal = (nutrition_goal: NutritionGoal) => {
    updateProfile.mutate({ nutrition_goal });
  };

  // Body Profile (height/weight/age/sex — see BodyMetricsScreen) lives on
  // the Progress tab, not the Profile stack Settings is part of — same
  // cross-stack hop VitalsTile's weight segment already makes.
  const goToBodyMetrics = () =>
    rootNavigation.navigate('MainTabs', {
      screen: 'ProgressTab',
      params: { screen: 'BodyMetrics' },
    });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <Header title="Settings" />

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
          <Card
            variant="elevated"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
            }}
          >
            <Avatar
              uri={profile?.avatar_url}
              focalX={profile?.avatar_focal_x}
              focalY={profile?.avatar_focal_y}
              size={56}
            />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text variant="subtitle">
                  {profile?.display_name ?? 'Athlete'}
                </Text>
                {profile?.is_premium ? <ProBadge /> : null}
              </View>
              <Text variant="body" color="secondary">
                {profile?.email}
              </Text>
            </View>
          </Card>

          <View style={{ gap: theme.spacing.sm }}>
            <SectionLabel>ACCOUNT</SectionLabel>
            <Card variant="elevated" style={{ gap: 0 }}>
              <ListRow
                title="Account"
                icon="user"
                showChevron
                onPress={() => navigation.navigate('Account')}
              />
            </Card>
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <SectionLabel>MEMBERSHIP</SectionLabel>
            <Pressable
              onPress={onPressPremiumBanner}
              accessibilityLabel={
                profile?.is_premium
                  ? 'Manage SetSocial Pro subscription'
                  : 'Upgrade to SetSocial Pro'
              }
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                padding: theme.spacing.md,
                borderRadius: theme.radii.lg,
                borderWidth: 1,
                backgroundColor: `${theme.gradients.premium[1]}14`,
                borderColor: `${theme.gradients.premium[1]}59`,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: theme.radii.md,
                  backgroundColor: theme.gradients.premium[1],
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="zap" size="sm" color={theme.colors.bg.base} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="body" style={{ fontWeight: '700' }}>
                  {profile?.is_premium
                    ? 'SetSocial Pro — Active'
                    : 'SetSocial Pro'}
                </Text>
                <Text
                  variant="caption"
                  color="secondary"
                  style={{ marginTop: 1 }}
                >
                  {profile?.is_premium
                    ? 'Unlimited Arnold, adaptive intelligence, and more'
                    : 'Unlock unlimited Arnold and adaptive intelligence'}
                </Text>
              </View>
              {profile?.is_premium ? (
                <Text
                  variant="caption"
                  color="secondary"
                  style={{ fontWeight: '700' }}
                >
                  Manage
                </Text>
              ) : (
                <Text
                  variant="caption"
                  style={{
                    color: theme.gradients.premium[1],
                    fontWeight: '700',
                  }}
                >
                  Upgrade
                </Text>
              )}
            </Pressable>
            {REVENUECAT_ENABLED && !profile?.is_premium ? (
              <Card variant="elevated" style={{ gap: 0 }}>
                <ListRow
                  title="Restore Purchases"
                  icon="rotateCcw"
                  onPress={onRestorePurchases}
                />
              </Card>
            ) : null}
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <SectionLabel>APPEARANCE</SectionLabel>
            <Card variant="elevated" style={{ gap: 0 }}>
              <View
                style={{
                  gap: theme.spacing.sm,
                  paddingVertical: theme.spacing.sm,
                }}
              >
                <Text variant="label" color="secondary">
                  THEME
                </Text>
                <SegmentedControl
                  options={[
                    { value: 'dark', label: 'Dark' },
                    { value: 'light', label: 'Light' },
                  ]}
                  value={colorScheme}
                  onChange={setColorScheme}
                />
                <Text variant="caption" color="tertiary">
                  Dark is the default SetSocial look. Light uses the same
                  brand colors on a bright background.
                </Text>
              </View>
            </Card>
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <SectionLabel>NUTRITION</SectionLabel>
            <Card variant="elevated" style={{ gap: 0 }}>
              <View
                style={{
                  gap: theme.spacing.sm,
                  paddingVertical: theme.spacing.sm,
                }}
              >
                <Text variant="label" color="secondary">
                  GOAL
                </Text>
                <SegmentedControl
                  options={GOAL_OPTIONS}
                  value={profile?.nutrition_goal ?? 'maintain'}
                  onChange={setNutritionGoal}
                />
                <Text variant="caption" color="tertiary">
                  Shifts your daily calorie target — cut −500, maintain even,
                  bulk +300 — and Arnold's macro split.
                </Text>
              </View>
              <ListRow
                title="Body Profile"
                subtitle="Height, weight, age & sex — sets your calorie baseline"
                icon="flame"
                showChevron
                onPress={goToBodyMetrics}
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border.subtle,
                  marginTop: theme.spacing.sm,
                  paddingTop: theme.spacing.md,
                }}
              />
            </Card>
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <SectionLabel>PREFERENCES</SectionLabel>
            <Card variant="elevated" style={{ gap: 0 }}>
              <View
                style={{
                  gap: theme.spacing.sm,
                  paddingVertical: theme.spacing.sm,
                }}
              >
                <Text variant="label" color="secondary">
                  UNITS
                </Text>
                <SegmentedControl
                  options={[
                    { value: 'kg', label: 'Kilograms' },
                    { value: 'lb', label: 'Pounds' },
                  ]}
                  value={profile?.unit_preference ?? 'kg'}
                  onChange={setUnitPreference}
                />
              </View>
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border.subtle,
                }}
              >
                <SettingsToggleRow
                  title="Focus Mode"
                  description="Hide Live Now, nearby friends, and friend activity on your Home tab."
                  value={focusModeEnabled}
                  onChange={setFocusModeEnabled}
                />
              </View>
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border.subtle,
                }}
              >
                <SettingsToggleRow
                  title="Rest Timer"
                  description="Automatically start a countdown after logging a set."
                  value={restTimerEnabled}
                  onChange={setRestTimerEnabled}
                />
              </View>
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border.subtle,
                }}
              >
                <SettingsToggleRow
                  title="Arnold Recommendations"
                  description="Show a suggestion from Arnold after completing a set."
                  value={recommendationsEnabled}
                  onChange={setRecommendationsEnabled}
                />
              </View>
            </Card>
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <SectionLabel>NOTIFICATIONS</SectionLabel>
            <Card variant="elevated" style={{ gap: 0 }}>
              <ListRow
                title="Notifications"
                icon="bell"
                showChevron
                onPress={() => navigation.navigate('NotificationSettings')}
              />
            </Card>
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <SectionLabel>PRIVACY & SAFETY</SectionLabel>
            <Card variant="elevated" style={{ gap: 0 }}>
              <ListRow
                title="Privacy"
                icon="lock"
                showChevron
                onPress={() => navigation.navigate('Privacy')}
              />
              <ListRow
                title="Blocked Users"
                icon="circleAlert"
                showChevron
                onPress={() => navigation.navigate('BlockedUsers')}
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border.subtle,
                }}
              />
            </Card>
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <SectionLabel>TRAINING</SectionLabel>
            <Card variant="elevated" style={{ gap: 0 }}>
              <ListRow
                title="Equipment"
                icon="dumbbell"
                showChevron
                onPress={() => navigation.navigate('Equipment')}
              />
              <ListRow
                title="Integrations"
                icon="repeat"
                showChevron
                onPress={() => navigation.navigate('Integrations')}
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border.subtle,
                }}
              />
            </Card>
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <SectionLabel>SUPPORT</SectionLabel>
            <Card variant="elevated" style={{ gap: 0 }}>
              <ListRow
                title="Contact Support"
                icon="mail"
                onPress={contactSupport}
              />
            </Card>
          </View>

          <Button
            label="Sign Out"
            variant="ghost"
            icon="logOut"
            loading={signingOut}
            onPress={() => signOut()}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
