import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../theme/ThemeProvider';
import { useFloatingTabBarHeight } from '../../navigation/MainTabs';
import { Text, Header, Button } from '../../components/core';
import { useAuthStore } from '../../store/authStore';
import { useAssignCardioDay } from '../../services/api/queries/weeklySchedule';
import type { ProgramsStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<ProgramsStackParamList>;
type Route = RouteProp<ProgramsStackParamList, 'AssignCardioDay'>;

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Cardio's equivalent of AssignTrainingDayScreen — deliberately thinner,
 * since there's no template to pick: the activity and its parameters are
 * chosen at log time (LogCardioScreen), not assignment time. This screen
 * only records that the weekday is a cardio day at all. */
export function AssignCardioDayScreen() {
  const theme = useTheme();
  const tabBarHeight = useFloatingTabBarHeight();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const userId = useAuthStore(state => state.userId);
  const assignCardioDay = useAssignCardioDay();

  const [dayOfWeek, setDayOfWeek] = useState<number | null>(
    params?.initialDayOfWeek ?? null,
  );

  const onAssign = async () => {
    if (!userId || dayOfWeek == null) return;
    try {
      await assignCardioDay.mutateAsync({ userId, dayOfWeek });
      navigation.goBack();
    } catch (err) {
      Alert.alert(
        'Could not mark this day as cardio',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <Header title="Log Cardio Weekly" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingTop: 0,
          paddingBottom: theme.spacing.lg + tabBarHeight,
          gap: theme.spacing.xl,
        }}
      >
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" color="secondary">
            DAY OF WEEK
          </Text>
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between' }}
          >
            {WEEKDAY_LABELS.map((label, index) => {
              const selected = dayOfWeek === index;
              return (
                <Pressable
                  key={index}
                  onPress={() => setDayOfWeek(index)}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: theme.radii.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: selected
                      ? theme.colors.accent.orange
                      : theme.colors.bg.surface,
                    borderWidth: 1,
                    borderColor: selected
                      ? theme.colors.accent.orange
                      : theme.colors.border.subtle,
                  }}
                >
                  <Text
                    variant="body"
                    color={selected ? 'onAccent' : 'primary'}
                    style={{ fontWeight: '700' }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text variant="caption" color="tertiary">
            You'll pick the activity and log what you did each time — nothing
            else to set up here.
          </Text>
        </View>

        <Button
          label="Mark as Cardio Day"
          onPress={onAssign}
          disabled={dayOfWeek == null}
          loading={assignCardioDay.isPending}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
