import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import { Text, Button, AiCard } from '../../components/core';
import { useOnboardingStore } from '../../store/onboardingStore';
import { useAuthStore } from '../../store/authStore';
import { useBuildFirstWeek } from '../../services/api/queries/firstWeek';
import { getFirstWeekPlan } from '../../constants/firstWeekSplits';
import { useCompleteOnboarding } from './useCompleteOnboarding';
import type { OnboardingStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'BuildFirstWeek'>;

/**
 * Last onboarding screen — the coach offers to build a full first week
 * (one muscle-group day per day-per-week the user already chose) before
 * handing off to the app proper. No StepProgress: this is a decision, not a
 * numbered data-collection step.
 */
export function BuildFirstWeekScreen(_props: Props) {
  const theme = useTheme();
  const userId = useAuthStore(state => state.userId);
  const daysPerWeek = useOnboardingStore(state => state.daysPerWeek);
  const buildFirstWeek = useBuildFirstWeek();
  const {
    complete,
    isPending: completePending,
    error: completeError,
  } = useCompleteOnboarding();
  const [buildError, setBuildError] = useState<string | null>(null);

  const plan = daysPerWeek ? getFirstWeekPlan(daysPerWeek) : [];
  const isBusy = buildFirstWeek.isPending || completePending;

  const onBuildWeek = async () => {
    if (!userId || !daysPerWeek) return;
    setBuildError(null);
    try {
      await buildFirstWeek.mutateAsync({ userId, daysPerWeek });
      await complete();
    } catch (err) {
      setBuildError(
        err instanceof Error
          ? err.message
          : 'Could not build your week. Please try again.',
      );
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexGrow: 1,
          padding: theme.spacing.xl,
          gap: theme.spacing.lg,
        }}
      >
        <View>
          <Text variant="title">One more thing</Text>
          <Text variant="body" color="secondary">
            Arnold can put your first week on the calendar right now.
          </Text>
        </View>

        <AiCard>
          <Text variant="label" color="secondary">
            ARNOLD
          </Text>
          <Text variant="subtitle">
            Want me to build your first week? {plan.length} days, one muscle
            group a day, so nothing gets missed.
          </Text>
          {plan.length > 0 ? (
            <Text variant="caption" color="secondary">
              {plan.map(day => day.label).join(' → ')}
            </Text>
          ) : null}
        </AiCard>

        {buildError || completeError ? (
          <Text
            variant="caption"
            style={{ color: theme.colors.semantic.danger }}
          >
            {buildError ?? completeError}
          </Text>
        ) : null}

        <View style={{ flex: 1, minHeight: theme.spacing.xl }} />

        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label="Build my week"
            onPress={onBuildWeek}
            loading={buildFirstWeek.isPending}
            disabled={isBusy}
          />
          <Button
            label="I'll pick my own days"
            variant="secondary"
            onPress={() => complete()}
            loading={completePending && !buildFirstWeek.isPending}
            disabled={isBusy}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
