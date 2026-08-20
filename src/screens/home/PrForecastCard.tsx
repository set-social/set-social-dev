import React from 'react';
import { Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { Card, Text, Icon } from '../../components/core';
import { formatWeight, unitLabel } from '../../utils/units';
import type { PrPrediction } from '../../services/coaching';
import type { UnitPreference } from '../../types/database';
import type { RootStackParamList } from '../../navigation/types';

type RootNav = NativeStackNavigationProp<RootStackParamList>;

/** The single highest-confidence result from coachingEngine.predictPersonalRecords
 * — already computed and shown on the Progress tab's PR screens, just never
 * teased anywhere else. `prediction` is computed by the caller (TodayScreen
 * already fetches the loggedSets this needs for other things) rather than
 * this component re-fetching the same data. */
export function PrForecastCard({
  prediction,
  unitPref,
}: {
  prediction: PrPrediction | null;
  unitPref: UnitPreference;
}) {
  const theme = useTheme();
  const rootNavigation = useNavigation<RootNav>();
  if (!prediction) return null;

  // parseISO (not `new Date(string)`) — a plain yyyy-MM-dd string parses as
  // UTC midnight with the native constructor, which silently shifts the
  // computed day count by one in any negative-UTC-offset timezone.
  const daysOut = Math.max(1, differenceInCalendarDays(parseISO(prediction.targetDate), new Date()));

  const goToPrDetail = () =>
    rootNavigation.navigate('MainTabs', {
      screen: 'ProgressTab',
      params: { screen: 'PRDetail', params: { exerciseId: prediction.exerciseId } },
    });

  return (
    <Pressable onPress={goToPrDetail} accessibilityRole="button">
      <Card variant="elevated" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: theme.radii.pill,
            backgroundColor: `${theme.colors.accent.orange}24`,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="trophy" size="sm" color={theme.colors.accent.orange} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="subtitle">On pace for a {prediction.exerciseName} PR</Text>
          <Text variant="caption" color="secondary">
            {formatWeight(prediction.predictedE1rm, unitPref)} {unitLabel(unitPref)} · ~{daysOut} day{daysOut === 1 ? '' : 's'} out
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="subtitle" style={{ color: theme.colors.accent.orange }}>
            {Math.round(prediction.confidence * 100)}%
          </Text>
          <Text variant="caption" color="tertiary" style={{ fontSize: 9 }}>
            CONFIDENCE
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}
