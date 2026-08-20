import { Platform } from 'react-native';
import Purchases, {
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type PurchasesError,
  type PurchasesOffering,
  type PurchasesOfferings,
  type PurchasesPackage,
} from 'react-native-purchases';
import { REVENUECAT_API_KEY_ANDROID, REVENUECAT_API_KEY_IOS } from '@env';

/** Hard kill-switch for the whole RevenueCat integration. A `test_` Test
 * Store key shipped in a real App Store build, and RevenueCat's native SDK
 * throws a fatal "Wrong API Key" alert for that combination on launch —
 * crashing the app for every user on Purchases.configure(). Flip this back
 * to true only once real platform-specific keys (appl_.../goog_...) from
 * RevenueCat's dashboard are in .env and a fresh build has shipped.
 * profiles.is_premium (Supabase, e.g. admin_grant_premium) is untouched by
 * this flag — beta testers granted Pro manually keep full access either
 * way; only actual purchasing/restoring is unavailable while this is off. */
export const REVENUECAT_ENABLED = false;

/** The RevenueCat dashboard entitlement identifier that gates SetSocial
 * Pro — attach every product (lifetime/yearly/monthly) to this same
 * entitlement in the dashboard so any of the three unlocks it identically. */
export const ENTITLEMENT_ID = 'SetSocial Pro';

/** RevenueCat's own predefined package-type slots on an Offering
 * (offering.lifetime/annual/monthly) cover the common case where each
 * product was configured with the matching standard package type in the
 * dashboard. If a package was set up with a custom identifier instead, this
 * falls back to matching availablePackages by identifier string, so either
 * dashboard setup style resolves the same three plans here. */
export type ThreePlanPackages = {
  monthly: PurchasesPackage | null;
  yearly: PurchasesPackage | null;
  lifetime: PurchasesPackage | null;
};

export function getThreePlanPackages(offering: PurchasesOffering | null | undefined): ThreePlanPackages {
  if (!offering) return { monthly: null, yearly: null, lifetime: null };
  const byIdentifier = (id: string) => offering.availablePackages.find(pkg => pkg.identifier === id) ?? null;
  return {
    monthly: offering.monthly ?? byIdentifier('monthly'),
    yearly: offering.annual ?? byIdentifier('yearly'),
    lifetime: offering.lifetime ?? byIdentifier('lifetime'),
  };
}

let configured = false;

/** Call once, as early as possible (AuthProvider, before any screen could
 * try to fetch offerings or present a paywall) — safe to call more than
 * once, but only configures the underlying SDK the first time. Identifying
 * the actual signed-in user happens separately via identifyRevenueCatUser,
 * once auth resolves; before that, RevenueCat tracks an anonymous id. */
export function configureRevenueCat(): void {
  if (!REVENUECAT_ENABLED || configured) return;
  configured = true;

  const apiKey = Platform.select({ ios: REVENUECAT_API_KEY_IOS, android: REVENUECAT_API_KEY_ANDROID });
  if (!apiKey) return;

  if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  Purchases.configure({ apiKey });
}

/** Links the RevenueCat app_user_id to our own Supabase user id, so a
 * future RevenueCat webhook event's app_user_id maps directly onto
 * profiles.id with no separate mapping table — mirrors how every other
 * cross-system id in this app (push tokens, integration connections) is
 * keyed straight off auth.uid(). Call after Supabase auth resolves a
 * session (AuthProvider), never before configureRevenueCat(). */
export async function identifyRevenueCatUser(userId: string): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logIn(userId);
  } catch (err) {
    console.error('[RevenueCat] logIn failed', err);
  }
}

/** Clears the linked app_user_id on sign-out, generating a fresh anonymous
 * id — otherwise the next person to sign in on a shared device would
 * inherit the previous athlete's RevenueCat identity. */
export async function resetRevenueCatUser(): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logOut();
  } catch (err) {
    console.error('[RevenueCat] logOut failed', err);
  }
}

export function hasProEntitlement(customerInfo: CustomerInfo | null | undefined): boolean {
  return customerInfo?.entitlements.active[ENTITLEMENT_ID] != null;
}

export async function fetchOfferings(): Promise<PurchasesOfferings> {
  if (!REVENUECAT_ENABLED) return { all: {}, current: null };
  return Purchases.getOfferings();
}

export async function fetchCustomerInfo(): Promise<CustomerInfo | null> {
  if (!REVENUECAT_ENABLED) return null;
  return Purchases.getCustomerInfo();
}

export async function restorePurchases(): Promise<CustomerInfo> {
  if (!REVENUECAT_ENABLED) throw new Error("Restoring purchases isn't available yet — check back soon.");
  return Purchases.restorePurchases();
}

export function isCancelledPurchaseError(err: unknown): boolean {
  return isPurchasesError(err) && err.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR;
}

function isPurchasesError(err: unknown): err is PurchasesError {
  return typeof err === 'object' && err !== null && 'code' in err && 'message' in err;
}

/** Purchase result as a discriminated union rather than throw-on-cancel —
 * a user backing out of the store sheet is the single most common outcome
 * here and isn't an error worth an Alert, so callers can switch on `status`
 * instead of wrapping every purchase call in try/catch just to special-case
 * cancellation. */
export type PurchaseOutcome =
  | { status: 'purchased'; customerInfo: CustomerInfo }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export async function purchasePackage(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  if (!REVENUECAT_ENABLED) {
    return { status: 'error', message: "Purchasing isn't available yet — check back soon." };
  }
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { status: 'purchased', customerInfo };
  } catch (err) {
    if (isCancelledPurchaseError(err)) return { status: 'cancelled' };
    const message = isPurchasesError(err) ? err.message : 'Something went wrong completing your purchase.';
    return { status: 'error', message };
  }
}
