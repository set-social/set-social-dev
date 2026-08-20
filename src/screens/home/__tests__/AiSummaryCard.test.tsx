import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { AiSummaryCard } from '../AiSummaryCard';
import { useCoachSummaryStore } from '../../../store/coachSummaryStore';
import type { ReadinessResult } from '../../../services/coaching';

afterEach(() => {
  useCoachSummaryStore.setState({ dismissed: false });
});

describe('AiSummaryCard', () => {
  it('renders the headline and summary', async () => {
    const { getByText } = await render(
      <AiSummaryCard headline="Ready to train" summary="You're primed for a strong session." band="high" isRestDay={false} />,
    );

    expect(getByText("Arnold's Summary")).toBeTruthy();
    expect(getByText('Ready to train')).toBeTruthy();
    expect(getByText("You're primed for a strong session.")).toBeTruthy();
  });

  it('hides itself once dismissed, without clearing the store for other consumers to un-hide it', async () => {
    const { getByLabelText, queryByText } = await render(
      <AiSummaryCard headline="Ready to train" summary="You're primed for a strong session." band="high" isRestDay={false} />,
    );

    await fireEvent.press(getByLabelText('Dismiss coach summary'));

    expect(queryByText("Arnold's Summary")).toBeNull();
    expect(useCoachSummaryStore.getState().dismissed).toBe(true);
  });

  it('stays dismissed across remounts within the same app session — only a fresh store (full relaunch) un-hides it', async () => {
    useCoachSummaryStore.setState({ dismissed: true });

    const { queryByText } = await render(
      <AiSummaryCard headline="Ready to train" summary="You're primed for a strong session." band="high" isRestDay={false} />,
    );

    expect(queryByText("Arnold's Summary")).toBeNull();
  });

  it('renders nothing when there is no summary yet, regardless of dismissal state', async () => {
    const { queryByText } = await render(
      <AiSummaryCard headline="" summary="" band={null} isRestDay={false} />,
    );

    expect(queryByText("Arnold's Summary")).toBeNull();
  });

  describe('readiness breakdown', () => {
    const READINESS: ReadinessResult = {
      score: 82,
      band: 'high' as const,
      factors: [
        { key: 'sleep', label: 'Sleep duration', impact: 'positive' as const, weight: 0.8, detail: 'Slept 8h — above your recent average.', available: true },
        { key: 'soreness', label: 'Muscle soreness', impact: 'neutral' as const, weight: 0.1, detail: 'Soreness is typical for you.', available: true },
        { key: 'stress', label: 'Stress level', impact: 'negative' as const, weight: 0.3, detail: 'Stress reported as high.', available: true },
        { key: 'wearable_recovery', label: 'Whoop recovery', impact: 'neutral' as const, weight: 0, detail: '', available: false },
      ],
      recommendedIntensity: 'full' as const,
      recommendedRpeRange: [7, 9] as [number, number],
      estimatedSessionQuality: 'excellent' as const,
      summary: 'Readiness appears high today.',
      computedAt: '2026-01-01T00:00:00.000Z',
    };

    it('shows no "See why" toggle when readiness is absent', async () => {
      const { queryByLabelText } = await render(
        <AiSummaryCard headline="Ready to train" summary="Today is a training day." band="high" isRestDay={false} />,
      );
      expect(queryByLabelText('See why')).toBeNull();
    });

    it('shows no toggle when every factor is unavailable', async () => {
      const { queryByLabelText } = await render(
        <AiSummaryCard
          headline="Ready to train"
          summary="Today is a training day."
          band="high"
          isRestDay={false}
          readiness={{ ...READINESS, factors: READINESS.factors.map(f => ({ ...f, available: false })) }}
        />,
      );
      expect(queryByLabelText('See why')).toBeNull();
    });

    it('starts collapsed, then expands to show only the available factors in order', async () => {
      const { getByLabelText, getByText, queryByText } = await render(
        <AiSummaryCard headline="Ready to train" summary="Today is a training day." band="high" isRestDay={false} readiness={READINESS} />,
      );

      expect(queryByText('Sleep duration')).toBeNull();

      await fireEvent.press(getByLabelText('See why'));
      expect(getByText('Sleep duration')).toBeTruthy();
      expect(getByText('Slept 8h — above your recent average.')).toBeTruthy();
      expect(getByText('Muscle soreness')).toBeTruthy();
      expect(getByText('Stress level')).toBeTruthy();
      expect(queryByText('Whoop recovery')).toBeNull();
    });

    it('collapses again on a second tap', async () => {
      const { getByLabelText, getByText, queryByText } = await render(
        <AiSummaryCard headline="Ready to train" summary="Today is a training day." band="high" isRestDay={false} readiness={READINESS} />,
      );

      await fireEvent.press(getByLabelText('See why'));
      expect(getByText('Sleep duration')).toBeTruthy();

      await fireEvent.press(getByLabelText('Hide readiness breakdown'));
      expect(queryByText('Sleep duration')).toBeNull();
    });
  });
});
