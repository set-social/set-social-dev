import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useQueryClient } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type {
  PurchasesOffering,
  PurchasesPackage,
} from 'react-native-purchases';
import { useTheme } from '../../theme/ThemeProvider';
import { useAuthStore } from '../../store/authStore';
import {
  Text,
  Button,
  IconButton,
  Icon,
  SelectableCard,
  LoadingState,
  EmptyState,
  SetSocialIcon,
} from '../../components/core';
import {
  useOfferings,
  usePurchasePackage,
  useRestorePurchases,
  useHasUsedTrial,
  useStartFreeTrial,
} from '../../services/api/queries/purchases';
import { useProfile } from '../../services/api/queries/profiles';
import {
  getThreePlanPackages,
  hasProEntitlement,
  REVENUECAT_ENABLED,
} from '../../services/purchases/revenueCat';
import { getErrorMessage } from '../../utils/errors';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Paywall'>;

const TRIGGER_COPY: Record<string, string> = {
  ai_chat: "You've used your 3 free Arnold messages this month.",
  analytics: 'Deeper progress analytics are part of SetSocial Pro.',
  widget: 'The home screen widget is part of SetSocial Pro.',
  program_regen: 'Rebuilding your program is part of SetSocial Pro.',
  adaptive_coaching: 'Adaptive Coaching Intelligence is part of SetSocial Pro.',
  form_check: "You've used your 3 free Form Checks this month.",
  welcome_email: 'Your 3-day free trial is ready — see everything it unlocks below.',
};

const TRIAL_DAYS = 3;

const YEARLY_PRICE_DISPLAY = '$69.99 / year';
const MONTHLY_PRICE_DISPLAY = '$8.99 / month';
const PRIVACY_POLICY_URL = 'https://setsocial.app/privacy';
const TERMS_OF_USE_URL = 'https://setsocial.app/terms';

const FEATURES = [
  'Unlimited Arnold conversations',
  'Unlimited Form Checks with Arnold',
  'Arnold Macro Tracking',
  'Adaptive Coaching Intelligence',
  'Regenerate your program anytime',
  'Full progress analytics & PR history',
  'Home screen widget',
];

type Plan = {
  pkg: PurchasesPackage;
  label: string;
  priceLine: string;
  tag?: string;
};

function buildPlans(offering: PurchasesOffering | null | undefined): Plan[] {
  const { monthly, yearly, lifetime } = getThreePlanPackages(offering);
  const plans: Plan[] = [];
  if (yearly) {
    plans.push({
      pkg: yearly,
      label: 'Yearly',
      priceLine: yearly.product.pricePerMonthString
        ? `${yearly.product.pricePerMonthString}/mo — billed ${yearly.product.priceString}/yr`
        : `${yearly.product.priceString}/year`,
      tag: 'Best value',
    });
  }
  if (monthly) {
    plans.push({
      pkg: monthly,
      label: 'Monthly',
      priceLine: `${monthly.product.priceString}/month`,
    });
  }
  if (lifetime) {
    plans.push({
      pkg: lifetime,
      label: 'Lifetime',
      priceLine: `${lifetime.product.priceString}, once`,
    });
  }
  return plans;
}

/**
 * SetSocial Pro's one purchase surface — reached the same way from every
 * gated feature (AI Chat's message cap, locked analytics, widget setup,
 * program regeneration, adaptive coaching) via
 * rootNavigation.navigate('Paywall', { trigger: ... }).
 *
 * Fully custom rather than RevenueCat's hosted UI — this app's own theme,
 * components, and copy, built on the plain data hooks (useOfferings,
 * usePurchasePackage, useRestorePurchases) rather than a dashboard-configured
 * template. `trigger`'s copy swaps in the reason the athlete landed here.
 */
export function PaywallScreen({ navigation, route }: Props) {
  const theme = useTheme();
  const userId = useAuthStore(state => state.userId);
  const queryClient = useQueryClient();
  const trigger = route.params?.trigger;
  const subtitle =
    (trigger && TRIGGER_COPY[trigger]) ??
    'Train smarter with the full SetSocial experience.';

  const { data: profile } = useProfile(userId);
  const { data: hasUsedTrial } = useHasUsedTrial(userId);
  const startFreeTrial = useStartFreeTrial(userId);
  // Undefined while either query is still loading — deliberately not
  // eligible-by-default in that window, so the CTA doesn't flash in and
  // then disappear once hasUsedTrial actually resolves true.
  const trialEligible =
    profile != null && hasUsedTrial != null && !profile.is_premium && !hasUsedTrial;

  const {
    data: offerings,
    isLoading: offeringsLoading,
    refetch: refetchOfferings,
  } = useOfferings();
  const plans = useMemo(() => buildPlans(offerings?.current), [offerings]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedId || plans.length === 0) return;
    setSelectedId(plans[0].pkg.identifier);
  }, [plans, selectedId]);

  const purchasePackage = usePurchasePackage();
  const restorePurchases = useRestorePurchases();

  const onPurchase = () => {
    const plan = plans.find(p => p.pkg.identifier === selectedId);
    if (!plan) return;
    purchasePackage.mutate(plan.pkg, {
      onSuccess: outcome => {
        if (outcome.status === 'purchased') {
          if (userId)
            queryClient.invalidateQueries({ queryKey: ['profile', userId] });
          navigation.goBack();
        } else if (outcome.status === 'error') {
          Alert.alert('Purchase failed', outcome.message);
        }
      },
    });
  };

  const onStartTrial = () => {
    startFreeTrial.mutate(undefined, {
      onSuccess: result => {
        if (result.granted) {
          Alert.alert(
            'Trial started',
            `Your ${TRIAL_DAYS}-day SetSocial Pro trial is active. Enjoy full access — no charge until it ends, and you can subscribe anytime from here to keep it.`,
          );
          navigation.goBack();
        } else {
          // Only reachable via a race (e.g. two taps before the first
          // response lands) — the button is already hidden once
          // trialEligible is false.
          Alert.alert(
            'Trial unavailable',
            result.reason === 'already_premium'
              ? "You're already on SetSocial Pro."
              : "You've already used your free trial on this account.",
          );
        }
      },
      onError: err =>
        Alert.alert('Could not start trial', getErrorMessage(err, 'Please try again.')),
    });
  };

  const onRestore = () => {
    restorePurchases.mutate(undefined, {
      onSuccess: customerInfo => {
        const entitled = hasProEntitlement(customerInfo);
        Alert.alert(
          entitled ? 'Restored' : 'Nothing to restore',
          entitled
            ? 'Your SetSocial Pro purchase has been restored.'
            : "We didn't find a previous purchase for this account.",
        );
        if (entitled) {
          if (userId)
            queryClient.invalidateQueries({ queryKey: ['profile', userId] });
          navigation.goBack();
        }
      },
      onError: err =>
        Alert.alert(
          'Restore failed',
          getErrorMessage(err, 'Please try again.'),
        ),
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'flex-end',
          paddingHorizontal: theme.spacing.md,
        }}
      >
        <IconButton
          name="x"
          variant="ghost"
          accessibilityLabel="Close"
          onPress={() => navigation.goBack()}
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingTop: 0,
          gap: theme.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      >
        <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
          <View
            style={{
              width: 88,
              height: 88,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: theme.gradients.premium[0],
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.9,
              shadowRadius: 12,
              elevation: 8,
            }}
          >
            <Svg width={88} height={88} style={{ position: 'absolute' }}>
              <Defs>
                <LinearGradient id="goldRing" x1="0%" y1="0%" x2="100%" y2="100%">
                  <Stop offset="0%" stopColor="#8A6516" />
                  <Stop offset="20%" stopColor="#FCEABB" />
                  <Stop offset="40%" stopColor="#C89B3C" />
                  <Stop offset="50%" stopColor="#FFF6D5" />
                  <Stop offset="65%" stopColor="#B8860B" />
                  <Stop offset="85%" stopColor="#FBDF93" />
                  <Stop offset="100%" stopColor="#8A6516" />
                </LinearGradient>
              </Defs>
              <Circle
                cx={44}
                cy={44}
                r={42.5}
                stroke="url(#goldRing)"
                strokeWidth={2.5}
                fill="none"
              />
            </Svg>
            <SetSocialIcon size={48} accessibilityLabel="" />
          </View>
          <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            <Text variant="display" style={{ textAlign: 'center' }}>
              SetSocial Pro
            </Text>
            <Text variant="title" style={{ textAlign: 'center' }}>
              {YEARLY_PRICE_DISPLAY}
            </Text>
            <Text
              variant="caption"
              color="secondary"
              style={{ textAlign: 'center' }}
            >
              or {MONTHLY_PRICE_DISPLAY}
            </Text>
            <Text
              variant="body"
              color="secondary"
              style={{ textAlign: 'center' }}
            >
              {subtitle}
            </Text>
          </View>
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          {FEATURES.map(feature => (
            <View
              key={feature}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.sm,
              }}
            >
              <Icon name="check" size="sm" color={theme.gradients.premium[1]} />
              <Text variant="body" style={{ flex: 1 }}>
                {feature}
              </Text>
            </View>
          ))}
        </View>

        {trialEligible ? (
          <View
            style={{
              gap: theme.spacing.sm,
              padding: theme.spacing.lg,
              borderRadius: theme.radii.lg,
              borderWidth: 1,
              borderColor: theme.gradients.premium[1],
              backgroundColor: `${theme.gradients.premium[1]}14`,
            }}
          >
            <Text variant="subtitle" style={{ textAlign: 'center' }}>
              Try SetSocial Pro free for {TRIAL_DAYS} days
            </Text>
            <Text variant="caption" color="secondary" style={{ textAlign: 'center' }}>
              One trial per account. No charge until it ends — cancel or just do nothing and it
              quietly reverts to Free.
            </Text>
            <Button
              label={`Start your ${TRIAL_DAYS}-Day Free Trial`}
              onPress={onStartTrial}
              gradientColors={theme.gradients.premium}
              loading={startFreeTrial.isPending}
              size="lg"
            />
          </View>
        ) : null}

        {!REVENUECAT_ENABLED ? (
          <EmptyState
            icon="clock"
            title="Not available yet"
            description="SetSocial Pro purchases aren't open during the beta — check back soon."
          />
        ) : offeringsLoading ? (
          <LoadingState fill={false} label="Loading plans…" />
        ) : plans.length === 0 ? (
          <EmptyState
            icon="circleAlert"
            title="Pricing unavailable"
            description="Check your connection and try again."
            actionLabel="Retry"
            onAction={() => refetchOfferings()}
          />
        ) : (
          <View style={{ gap: theme.spacing.sm }}>
            {plans.map(plan => (
              <SelectableCard
                key={plan.pkg.identifier}
                label={plan.tag ? `${plan.label} · ${plan.tag}` : plan.label}
                description={plan.priceLine}
                selected={selectedId === plan.pkg.identifier}
                onPress={() => setSelectedId(plan.pkg.identifier)}
              />
            ))}
          </View>
        )}

        {REVENUECAT_ENABLED ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Button
              label="Continue"
              onPress={onPurchase}
              gradientColors={theme.gradients.premium}
              loading={purchasePackage.isPending}
              disabled={!selectedId || plans.length === 0}
              size="lg"
            />
            <Button
              label="Restore Purchases"
              variant="ghost"
              onPress={onRestore}
              loading={restorePurchases.isPending}
            />
          </View>
        ) : null}

        <Text variant="caption" color="tertiary" style={{ textAlign: 'center' }}>
          Subscriptions renew automatically until cancelled. Manage or cancel
          anytime from your device's account settings.
        </Text>

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'center',
            gap: theme.spacing.md,
          }}
        >
          <Text
            variant="caption"
            color="secondary"
            style={{ textDecorationLine: 'underline' }}
            onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
          >
            Privacy Policy
          </Text>
          <Text
            variant="caption"
            color="secondary"
            style={{ textDecorationLine: 'underline' }}
            onPress={() => Linking.openURL(TERMS_OF_USE_URL)}
          >
            Terms of Use
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
