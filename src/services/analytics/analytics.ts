/**
 * No analytics provider is wired up yet. This is the single call site future
 * work (Amplitude/PostHog/etc.) would plug into — until then it just logs in
 * dev so events are still visible during development.
 *
 * Never pass raw health/pain text, workout notes, or other private content as
 * a prop — only counts, enums, and booleans.
 */
export type AnalyticsEvent =
  | 'readiness_viewed'
  | 'workout_adapted'
  | 'adaptation_accepted'
  | 'adaptation_rejected'
  | 'friends_posts_viewed'
  | 'friends_posts_card_tapped'
  | 'friends_posts_view_all_tapped'
  | 'friends_posts_retry_tapped';

export type AnalyticsProps = Record<string, string | number | boolean | null>;

export function trackEvent(name: AnalyticsEvent, props?: AnalyticsProps): void {
  if (__DEV__) {
    console.log(`[analytics] ${name}`, props ?? {});
  }
}
