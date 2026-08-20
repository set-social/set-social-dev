import { create } from 'zustand';

type CoachSummaryState = {
  dismissed: boolean;
  dismiss: () => void;
};

/** Deliberately not persisted (unlike activeWorkoutStore) — "only reload on
 * a full app relaunch" means this must reset on a fresh JS process, but
 * survive ordinary navigation/backgrounding within the same one. A plain
 * in-memory store gives exactly that: it lives as long as the app process
 * does, with nothing written to disk to carry a dismissal into the next
 * launch. */
export const useCoachSummaryStore = create<CoachSummaryState>(set => ({
  dismissed: false,
  dismiss: () => set({ dismissed: true }),
}));
