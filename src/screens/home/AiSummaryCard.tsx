import React from 'react';
import { useTheme } from '../../theme/ThemeProvider';
import { AiCard } from '../../components/core';
import type { ReadinessBand, ReadinessResult } from '../../services/coaching';
import { useCoachSummaryStore } from '../../store/coachSummaryStore';
import { CoachSummaryBody } from './CoachSummaryBody';

type AiSummaryCardProps = {
  headline: string;
  summary: string;
  band: ReadinessBand | null;
  isRestDay: boolean;
  /** Full readiness breakdown behind today's score — optional since not
   * every caller (or every test) has one computed. When present and it has
   * at least one factor with real data behind it, a "See why" toggle
   * reveals the same weighted factors evaluateReadiness already computed,
   * just never rendered anywhere before this. */
  readiness?: ReadinessResult | null;
};

/** Home's pre-workout synthesis card — data comes from coachingEngine.generateTodayFocusSummary, this just renders it (same "engine composes, screen renders" split every other coaching surface uses). Renders nothing when there's no summary to show (AI coaching disabled, nothing computed yet, or the athlete dismissed it this session — see useCoachSummaryStore, which resets on the next app launch rather than persisting the dismissal).
 *
 * Only mounted when today's plan doesn't merge into TodayHeroCard (rest day,
 * nothing scheduled, or a past/future date is selected) — see TodayScreen.tsx.
 * TodayHeroCard reuses the same CoachSummaryBody content for the common case. */
export function AiSummaryCard({ headline, summary, band, isRestDay, readiness }: AiSummaryCardProps) {
  const theme = useTheme();
  const dismissed = useCoachSummaryStore(state => state.dismissed);
  const dismiss = useCoachSummaryStore(state => state.dismiss);
  if (!summary || dismissed) return null;

  return (
    <AiCard style={{ gap: theme.spacing.sm }}>
      <CoachSummaryBody headline={headline} summary={summary} band={band} isRestDay={isRestDay} readiness={readiness} onDismiss={dismiss} />
    </AiCard>
  );
}
