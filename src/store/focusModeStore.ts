import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

type FocusModeState = {
  focusModeEnabled: boolean;
  /** False until the persisted value has been read back from AsyncStorage —
   * consumers that would otherwise flash the social sections on for one
   * frame before hiding them again should wait for this, same pattern as
   * activeWorkoutStore's hasHydrated. */
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  setFocusModeEnabled: (value: boolean) => void;
};

export const useFocusModeStore = create<FocusModeState>()(
  persist(
    set => ({
      focusModeEnabled: false,
      hasHydrated: false,
      setHasHydrated: value => set({ hasHydrated: value }),
      setFocusModeEnabled: value => set({ focusModeEnabled: value }),
    }),
    {
      name: 'focus-mode-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({ focusModeEnabled: state.focusModeEnabled }),
      onRehydrateStorage: () => state => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
