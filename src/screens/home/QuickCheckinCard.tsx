import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Card, Text, TextField, SegmentedControl, Button, Icon } from '../../components/core';
import { useReadinessContext, useSubmitReadinessCheckin } from '../../services/api/queries/coaching';
import { parseCheckinText, EdgeFunctionError } from '../../services/api/edgeFunctions';
import { RATING_OPTIONS, PAIN_OPTIONS } from '../log/PreWorkoutReviewScreen';
import { getErrorMessage } from '../../utils/errors';

/** Free-text alternative to the manual readiness form on
 * PreWorkoutReviewScreen — parses via the parse-checkin edge function, then
 * always shows the result back as this same editable rating scale before
 * saving, so a bad parse is caught by the athlete rather than silently
 * trusted. Self-gates on useReadinessContext's hasCheckin, same as it
 * already gates the manual form's entry point — once today's check-in
 * exists (from either path), this card disappears.
 *
 * Uses plain useState + async/await for the parse call (like ChatScreen's
 * sendChatMessage), not useMutation — it's a one-off action with no cache to
 * invalidate, and avoids requiring a QueryClientProvider just for this. */
export function QuickCheckinCard({ userId }: { userId: string | null }) {
  const theme = useTheme();
  const readinessContext = useReadinessContext(userId);
  const submitCheckin = useSubmitReadinessCheckin(userId);

  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(false);
  const [sleepHours, setSleepHours] = useState('');
  const [sleepQuality, setSleepQuality] = useState('3');
  const [soreness, setSoreness] = useState('3');
  const [stress, setStress] = useState('3');
  const [painToggle, setPainToggle] = useState<'yes' | 'no'>('no');
  const [painNotes, setPainNotes] = useState('');

  if (readinessContext.isLoading || readinessContext.hasCheckin) return null;

  const onParse = async () => {
    setParsing(true);
    try {
      const result = await parseCheckinText(text.trim());
      setSleepHours(result.sleepHours != null ? String(result.sleepHours) : '');
      setSleepQuality(result.sleepQuality != null ? String(result.sleepQuality) : '3');
      setSoreness(result.soreness != null ? String(result.soreness) : '3');
      setStress(result.stress != null ? String(result.stress) : '3');
      setPainToggle(result.hasPain ? 'yes' : 'no');
      setPainNotes(result.painNotes ?? '');
      setParsed(true);
    } catch (err) {
      Alert.alert(
        'Could not parse that',
        err instanceof EdgeFunctionError ? err.message : 'Please try again, or use the full check-in form instead.',
      );
    } finally {
      setParsing(false);
    }
  };

  const onSubmit = () => {
    submitCheckin.mutate(
      {
        sleepHours: sleepHours.trim() ? Number(sleepHours) : null,
        sleepQuality: Number(sleepQuality),
        soreness: Number(soreness),
        stress: Number(stress),
        hasPain: painToggle === 'yes',
        painNotes: painToggle === 'yes' ? painNotes.trim() || null : null,
        notes: text.trim() || null,
      },
      {
        onError: err => Alert.alert('Could not save check-in', getErrorMessage(err, 'Please try again.')),
      },
    );
  };

  if (parsed) {
    return (
      <Card variant="elevated" style={{ gap: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <Icon name="zap" size="sm" color={theme.colors.accent.primary} />
          <Text variant="subtitle">Does this look right?</Text>
        </View>
        <TextField label="Hours of sleep" keyboardType="decimal-pad" value={sleepHours} onChangeText={setSleepHours} />
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="label" color="secondary">
            SLEEP QUALITY (1-5)
          </Text>
          <SegmentedControl options={RATING_OPTIONS} value={sleepQuality} onChange={setSleepQuality} />
        </View>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="label" color="secondary">
            SORENESS (1-5)
          </Text>
          <SegmentedControl options={RATING_OPTIONS} value={soreness} onChange={setSoreness} />
        </View>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="label" color="secondary">
            STRESS (1-5)
          </Text>
          <SegmentedControl options={RATING_OPTIONS} value={stress} onChange={setStress} />
        </View>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="label" color="secondary">
            PAIN
          </Text>
          <SegmentedControl options={PAIN_OPTIONS} value={painToggle} onChange={setPainToggle} />
          {painToggle === 'yes' ? (
            <TextField placeholder="Where does it hurt?" value={painNotes} onChangeText={setPainNotes} multiline />
          ) : null}
        </View>
        <Button label="Save check-in" onPress={onSubmit} loading={submitCheckin.isPending} />
        <Button label="Start over" variant="ghost" onPress={() => setParsed(false)} />
      </Card>
    );
  }

  return (
    <Card variant="elevated" style={{ gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Icon name="zap" size="sm" color={theme.colors.accent.primary} />
        <Text variant="subtitle">Quick check-in</Text>
      </View>
      <Text variant="caption" color="secondary">
        Tell Arnold how you're feeling in your own words.
      </Text>
      <TextField
        placeholder="e.g. Slept like garbage, 5 hours, shoulders are sore"
        value={text}
        onChangeText={setText}
        multiline
      />
      <Button label="Send to Arnold" onPress={onParse} loading={parsing} disabled={text.trim().length === 0} />
    </Card>
  );
}
