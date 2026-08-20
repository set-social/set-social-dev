import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ColorScheme = 'dark' | 'light';

type ThemePreferenceState = {
  /** Dark is SetSocial's designed, default look — this only changes once an
   * athlete explicitly opts into Light from Settings. */
  colorScheme: ColorScheme;
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  setColorScheme: (value: ColorScheme) => void;
};

export const useThemePreferenceStore = create<ThemePreferenceState>()(
  persist(
    set => ({
      colorScheme: 'dark',
      hasHydrated: false,
      setHasHydrated: value => set({ hasHydrated: value }),
      setColorScheme: value => set({ colorScheme: value }),
    }),
    {
      name: 'theme-preference-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({ colorScheme: state.colorScheme }),
      onRehydrateStorage: () => state => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
