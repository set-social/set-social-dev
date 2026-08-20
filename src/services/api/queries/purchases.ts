import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Purchases, { type CustomerInfo } from 'react-native-purchases';
import { supabase } from '../supabaseClient';
import {
  fetchCustomerInfo,
  fetchOfferings,
  hasProEntitlement,
  purchasePackage as purchasePackageImpl,
  restorePurchases as restorePurchasesImpl,
  REVENUECAT_ENABLED,
  type PurchaseOutcome,
} from '../../purchases/revenueCat';
import type { PurchasesPackage } from 'react-native-purchases';

const CUSTOMER_INFO_KEY = ['revenueCatCustomerInfo'];
const OFFERINGS_KEY = ['revenueCatOfferings'];

export function useOfferings() {
  return useQuery({
    queryKey: OFFERINGS_KEY,
    queryFn: fetchOfferings,
    // Offering/product config changes happen in the RevenueCat dashboard,
    // not per-session — no need to refetch aggressively.
    staleTime: 5 * 60_000,
  });
}

/**
 * Live customer info — kept in sync two ways: the initial fetch, and
 * RevenueCat's own update listener (fires on purchase, renewal, restore,
 * or any entitlement change detected in the background), which invalidates
 * this query so every screen reading it re-renders without polling.
 */
export function useCustomerInfo() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Registering with the native module at all assumes Purchases.configure()
    // already ran — see REVENUECAT_ENABLED's own doc comment for why that's
    // currently skipped.
    if (!REVENUECAT_ENABLED) return;
    const listener = (customerInfo: CustomerInfo) => {
      queryClient.setQueryData(CUSTOMER_INFO_KEY, customerInfo);
    };
    Purchases.addCustomerInfoUpdateListener(listener);
    return () => {
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: CUSTOMER_INFO_KEY,
    queryFn: fetchCustomerInfo,
  });
}

/** Client-local read of the Pro entitlement — fast, reflects a purchase the
 * instant the store confirms it, before the RevenueCat webhook has synced
 * profiles.is_premium in Supabase. Use this for this device's own paywall/
 * purchase-button state; keep using `profile.is_premium` (useProfile) for
 * anything visible to other people (Pro badge, leaderboard) or enforced
 * server-side (the AI Coach message cap) — RevenueCat's client SDK only
 * knows about the signed-in device, not what other users should see. */
export function useIsProEntitled(): boolean {
  const { data: customerInfo } = useCustomerInfo();
  return hasProEntitlement(customerInfo);
}

export function usePurchasePackage() {
  const queryClient = useQueryClient();
  return useMutation<PurchaseOutcome, Error, PurchasesPackage>({
    mutationFn: pkg => purchasePackageImpl(pkg),
    onSuccess: outcome => {
      if (outcome.status !== 'purchased') return;
      queryClient.setQueryData(CUSTOMER_INFO_KEY, outcome.customerInfo);
    },
  });
}

export function useRestorePurchases() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: restorePurchasesImpl,
    onSuccess: customerInfo => {
      queryClient.setQueryData(CUSTOMER_INFO_KEY, customerInfo);
    },
  });
}

const TRIAL_USED_KEY = (userId: string) => ['freeTrialUsed', userId];

/** Whether this account has ever had a trial_3day subscriptions row — active,
 * expired, or canceled all count as "used" alike, since a trial is one-time
 * regardless of outcome (see start_free_trial's own one-per-account check,
 * 0076_free_trial.sql). Gates the Paywall's trial CTA: once this is true, it
 * never shows again for this account, converted or not. */
export function useHasUsedTrial(userId: string | null) {
  return useQuery({
    queryKey: TRIAL_USED_KEY(userId ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('user_id', userId as string)
        .eq('plan', 'trial_3day')
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data != null;
    },
    enabled: userId != null,
  });
}

type StartFreeTrialResult =
  | { granted: true; expires_at: string }
  | { granted: false; reason: 'already_premium' | 'already_used' };

/** Grants the one-time 3-day trial via start_free_trial (SECURITY DEFINER,
 * scoped to auth.uid() server-side — see 0076_free_trial.sql), then
 * invalidates both profile (is_premium flips everywhere it's read) and the
 * trial-used flag (hides the CTA immediately, whichever way this resolved). */
export function useStartFreeTrial(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const client = supabase as unknown as {
        rpc: (fn: 'start_free_trial') => Promise<{ data: StartFreeTrialResult | null; error: { message: string } | null }>;
      };
      const { data, error } = await client.rpc('start_free_trial');
      if (error) throw new Error(error.message);
      if (!data) throw new Error('No response from start_free_trial');
      return data;
    },
    onSuccess: () => {
      if (!userId) return;
      queryClient.invalidateQueries({ queryKey: ['profile', userId] });
      queryClient.invalidateQueries({ queryKey: TRIAL_USED_KEY(userId) });
    },
  });
}
