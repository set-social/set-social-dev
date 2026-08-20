import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

type RestTimerPreferenceState = {
  /** Defaults true so existing behavior is unchanged until an athlete
   * explicitly opts out from Settings. */
  restTimerEnabled: boolean;
  /** False until the persisted value has been read back from AsyncStorage —
   * same pattern as focusModeStore/activeWorkoutStore's hasHydrated. Not
   * currently consumed (the toggle's own default of true is safe to render
   * for one frame either way), kept for parity with the other preference
   * stores and in case a future consumer needs the guard. */
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  setRestTimerEnabled: (value: boolean) => void;
};

export const useRestTimerPreferenceStore = create<RestTimerPreferenceState>()(
  persist(
    set => ({
      restTimerEnabled: true,
      hasHydrated: false,
      setHasHydrated: value => set({ hasHydrated: value }),
      setRestTimerEnabled: value => set({ restTimerEnabled: value }),
    }),
    {
      name: 'rest-timer-preference-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({ restTimerEnabled: state.restTimerEnabled }),
      onRehydrateStorage: () => state => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
