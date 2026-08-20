import { useMutation } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import type { ReportReason, ReportTarget } from '../../../types/database';

export type CreateReportInput = {
  reporterId: string;
  reportedUserId: string;
  targetType: ReportTarget;
  targetId: string;
  reason: ReportReason;
  details?: string | null;
};

export function useCreateReport() {
  return useMutation({
    mutationFn: async (input: CreateReportInput) => {
      const { error } = await supabase.from('reports').insert({
        reporter_id: input.reporterId,
        reported_user_id: input.reportedUserId,
        target_type: input.targetType,
        target_id: input.targetId,
        reason: input.reason,
        details: input.details ?? null,
      });
      if (error) throw error;
    },
  });
}
