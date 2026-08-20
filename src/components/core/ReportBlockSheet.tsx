import React, { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from './Text';
import { ListRow } from './ListRow';
import { TextField } from './TextField';
import { Button } from './Button';
import { BottomSheet } from './BottomSheet';
import { useBlockUser } from '../../services/api/queries/community';
import { useCreateReport } from '../../services/api/queries/reports';
import type { ReportReason, ReportTarget } from '../../types/database';

const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'nudity_or_sexual_content', label: 'Nudity or sexual content' },
  { value: 'violence_or_dangerous_behavior', label: 'Violence or dangerous behavior' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'false_information', label: 'False information' },
  { value: 'other', label: 'Something else' },
];

type Step = 'menu' | 'reason' | 'details';

type ReportBlockSheetProps = {
  visible: boolean;
  onClose: () => void;
  currentUserId: string | null;
  targetType: ReportTarget;
  /** The id of the specific post/comment/message/conversation being reported. */
  targetId: string;
  reportedUserId: string;
  reportedUserName?: string;
  /** Fires after a successful block, in addition to onClose — callers that
   * need to navigate away (e.g. Post Detail, Conversation) hook in here. */
  onBlocked?: () => void;
};

/**
 * Guideline 1.2 entry point shared by every UGC surface (posts, comments,
 * feed cards, conversations): a menu offering Report and Block, where Report
 * drills into a reason list before submitting. Reuses the same
 * BottomSheet/ListRow primitives as the rest of the app rather than
 * introducing a new pattern per screen.
 */
export function ReportBlockSheet({
  visible,
  onClose,
  currentUserId,
  targetType,
  targetId,
  reportedUserId,
  reportedUserName,
  onBlocked,
}: ReportBlockSheetProps) {
  const theme = useTheme();
  const [step, setStep] = useState<Step>('menu');
  const [details, setDetails] = useState('');
  const blockUser = useBlockUser(currentUserId);
  const createReport = useCreateReport();

  useEffect(() => {
    if (visible) {
      setStep('menu');
      setDetails('');
    }
  }, [visible]);

  const name = reportedUserName ?? 'this athlete';

  const submitReport = (reason: ReportReason, reasonDetails?: string) => {
    if (!currentUserId) return;
    createReport.mutate(
      {
        reporterId: currentUserId,
        reportedUserId,
        targetType,
        targetId,
        reason,
        details: reasonDetails,
      },
      {
        onSuccess: () => {
          onClose();
          Alert.alert('Report submitted', "Thanks for letting us know — we'll review this.");
        },
        onError: err => {
          Alert.alert('Could not submit report', err instanceof Error ? err.message : 'Please try again.');
        },
      },
    );
  };

  const onSelectReason = (reason: ReportReason) => {
    if (reason === 'other') {
      setStep('details');
      return;
    }
    submitReport(reason);
  };

  const onSubmitDetails = () => {
    submitReport('other', details.trim() || undefined);
  };

  const confirmBlock = () => {
    Alert.alert(`Block ${name}?`, "They won't be able to see your content or message you, and you won't see theirs.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () =>
          blockUser.mutate(reportedUserId, {
            onSuccess: () => {
              onClose();
              onBlocked?.();
            },
            onError: err => {
              Alert.alert('Could not block', err instanceof Error ? err.message : 'Please try again.');
            },
          }),
      },
    ]);
  };

  const title = step === 'menu' ? undefined : step === 'reason' ? 'Report' : 'Tell us more';

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      {step === 'menu' ? (
        <View>
          <ListRow title="Report" icon="flag" onPress={() => setStep('reason')} />
          <ListRow
            title={`Block ${name}`}
            icon="circleAlert"
            onPress={confirmBlock}
            style={{ borderTopWidth: 1, borderTopColor: theme.colors.border.subtle }}
          />
        </View>
      ) : step === 'reason' ? (
        <View>
          {REPORT_REASONS.map((reason, index) => (
            <ListRow
              key={reason.value}
              title={reason.label}
              onPress={() => onSelectReason(reason.value)}
              style={index > 0 ? { borderTopWidth: 1, borderTopColor: theme.colors.border.subtle } : undefined}
            />
          ))}
        </View>
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <Text variant="body" color="secondary">
            Add any detail that will help us review this — optional.
          </Text>
          <TextField
            value={details}
            onChangeText={setDetails}
            placeholder="What happened?"
            multiline
            maxLength={500}
          />
          <Button label="Submit Report" onPress={onSubmitDetails} loading={createReport.isPending} />
        </View>
      )}
    </BottomSheet>
  );
}
