import { create } from 'zustand';

type AuthState = {
  /** Whether we've finished checking for a persisted Supabase session yet. */
  hydrated: boolean;
  isAuthenticated: boolean;
  onboardingCompleted: boolean;
  userId: string | null;
  /** Set when the soset://password-changed deep link fires (see
   * usePasswordChangeDeepLink), read once by SignInScreen to show a
   * confirmation banner, then cleared. `'error'`/`'expired'` cover the
   * confirm-password-change edge function's own failure redirects. */
  passwordChangeResult: 'success' | 'expired' | 'error' | null;
  setSession: (params: { userId: string | null; onboardingCompleted: boolean }) => void;
  setHydrated: () => void;
  signOutLocal: () => void;
  setPasswordChangeResult: (result: 'success' | 'expired' | 'error' | null) => void;
};

export const useAuthStore = create<AuthState>(set => ({
  hydrated: false,
  isAuthenticated: false,
  onboardingCompleted: false,
  userId: null,
  passwordChangeResult: null,
  setSession: ({ userId, onboardingCompleted }) =>
    set({
      isAuthenticated: userId != null,
      userId,
      onboardingCompleted,
      hydrated: true,
    }),
  setHydrated: () => set({ hydrated: true }),
  signOutLocal: () =>
    set({ isAuthenticated: false, userId: null, onboardingCompleted: false, hydrated: true }),
  setPasswordChangeResult: result => set({ passwordChangeResult: result }),
}));
