import React from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { format } from 'date-fns';
import { useTheme } from '../../theme/ThemeProvider';
import { Header, LoadingState, EmptyState } from '../../components/core';
import { useCoachingSummary } from '../../services/api/queries/coachingHistory';
import { useUnitPreference } from '../../hooks/useUnitPreference';
import { CoachingSummaryCards } from '../log/CoachingSummaryCards';
import type { ProgressStackParamList } from '../../navigation/types';

type Route = RouteProp<ProgressStackParamList, 'CoachingSummaryDetail'>;

// Read-only replay of a persisted PostWorkoutSummaryResult, reusing the
// exact same card stack WorkoutSummaryScreen renders live — see
// docs/coaching-history.md. Deliberately not WorkoutLogDetailScreen (which
// is an editable per-set breakdown, a different purpose entirely, and
// lives in ProgramsStack, not here).
export function CoachingSummaryDetailScreen() {
  const theme = useTheme();
  const { params } = useRoute<Route>();
  const unitPref = useUnitPreference();
  const { data: entry, isLoading } = useCoachingSummary(params.workoutLogId);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.base }}>
      <Header title={entry ? format(new Date(entry.createdAt), 'MMM d, yyyy') : 'Coaching Summary'} />
      {isLoading ? (
        <LoadingState />
      ) : !entry ? (
        <EmptyState icon="clock" title="Summary not found" description="This coaching summary is no longer available." />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }}
        >
          <CoachingSummaryCards summary={entry.summary} unitPref={unitPref} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
