import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { AiCard, Card, Text, Button } from '../../components/core';
import type { ReadinessBand, ReadinessResult } from '../../services/coaching';
import { useCoachSummaryStore } from '../../store/coachSummaryStore';
import { CoachSummaryBody } from './CoachSummaryBody';

type TodayHeroCardProps = {
  headline: string;
  summary: string;
  band: ReadinessBand | null;
  readiness?: ReadinessResult | null;
  planLabel: string;
  planTitle: string;
  planMeta?: string | null;
  ctaLabel: string;
  onCtaPress: () => void;
  ctaLoading?: boolean;
};

/** Home's single hero for the common case — today is selected and there's an
 * actual plan to start. Merges the AI coach summary (same CoachSummaryBody
 * AiSummaryCard renders standalone for every other case — rest day, nothing
 * scheduled, or a past/future date) directly on top of the plan's own
 * title/meta/CTA, in one card instead of two. See TodayScreen.tsx for which
 * branches route here vs. keep the old two-card layout.
 *
 * Dismissing the coach summary (shared useCoachSummaryStore — same flag
 * AiSummaryCard's own dismiss uses) only removes the AI content; the plan
 * and its CTA must stay visible either way, so this drops from the
 * AI-flavored `AiCard` treatment to a plain `Card` rather than disappearing. */
export function TodayHeroCard({
  headline,
  summary,
  band,
  readiness,
  planLabel,
  planTitle,
  planMeta,
  ctaLabel,
  onCtaPress,
  ctaLoading,
}: TodayHeroCardProps) {
  const theme = useTheme();
  const dismissed = useCoachSummaryStore(state => state.dismissed);
  const dismiss = useCoachSummaryStore(state => state.dismiss);
  const showCoachSummary = !!summary && !dismissed;

  const planBlock = (
    <View style={showCoachSummary ? { gap: theme.spacing.xs, paddingTop: theme.spacing.sm, borderTopWidth: 1, borderTopColor: theme.colors.border.subtle } : { gap: theme.spacing.xs }}>
      <Text variant="label" color="secondary">
        {planLabel}
      </Text>
      <Text variant="title">{planTitle}</Text>
      {planMeta ? (
        <Text variant="caption" color="secondary">
          {planMeta}
        </Text>
      ) : null}
      <Button label={ctaLabel} onPress={onCtaPress} loading={ctaLoading} style={{ marginTop: theme.spacing.xs }} />
    </View>
  );

  if (!showCoachSummary) {
    return (
      <Card variant="elevated" style={{ gap: theme.spacing.sm }}>
        {planBlock}
      </Card>
    );
  }

  return (
    <AiCard style={{ gap: theme.spacing.sm }}>
      <CoachSummaryBody headline={headline} summary={summary} band={band} isRestDay={false} readiness={readiness} onDismiss={dismiss} />
      {planBlock}
    </AiCard>
  );
}
