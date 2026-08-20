import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

type CoachingRecommendationsPreferenceState = {
  /** Defaults true so existing behavior is unchanged until an athlete
   * explicitly opts out from Settings. */
  recommendationsEnabled: boolean;
  /** False until the persisted value has been read back from AsyncStorage —
   * same pattern as the other preference stores (e.g. restTimerPreferenceStore). */
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  setRecommendationsEnabled: (value: boolean) => void;
};

export const useCoachingRecommendationsPreferenceStore = create<CoachingRecommendationsPreferenceState>()(
  persist(
    set => ({
      recommendationsEnabled: true,
      hasHydrated: false,
      setHasHydrated: value => set({ hasHydrated: value }),
      setRecommendationsEnabled: value => set({ recommendationsEnabled: value }),
    }),
    {
      name: 'coaching-recommendations-preference-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({ recommendationsEnabled: state.recommendationsEnabled }),
      onRehydrateStorage: () => state => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
