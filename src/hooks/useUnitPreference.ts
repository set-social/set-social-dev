import { useAuthStore } from '../store/authStore';
import { useProfile } from '../services/api/queries/profiles';
import type { UnitPreference } from '../types/database';

/** Convenience read of the signed-in user's unit preference, defaulted to
 * 'kg' while the profile is still loading (never blocks render). */
export function useUnitPreference(): UnitPreference {
  const userId = useAuthStore(state => state.userId);
  const { data: profile } = useProfile(userId);
  return profile?.unit_preference ?? 'kg';
}
