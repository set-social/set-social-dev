/**
 * Static feature flags. No remote config backend exists yet — this module is
 * the seed for one; swap the object literal for a fetched/cached config
 * without touching any call site that reads `featureFlags`.
 */
export type FeatureFlags = {
  aiCoaching: boolean;
  recoveryAdaptation: boolean;
  wearableIntegrations: boolean;
  /** Reserved for a still-unbuilt subsystem — no screen or call site reads
   * this yet, kept off deliberately rather than removed (see docs/
   * ai-coaching.md's Feature flags section). */
  videoAnalysis: boolean;
  /** Same as videoAnalysis — reserved, not yet wired to anything. */
  voiceCoaching: boolean;
  predictivePersonalRecords: boolean;
  coachingMemory: boolean;
  exerciseIntelligence: boolean;
  /** Same as videoAnalysis — reserved, not yet wired to anything. */
  communityChallenges: boolean;
  nutritionTracking: boolean;
  /** Gates persisting a post-workout coaching summary and the "Coaching
   * History" row on ProgressDashboardScreen — see docs/coaching-history.md.
   * Off means no coaching_summaries writes happen and the row is absent,
   * not a degraded/stub version of either (there's no meaningful "partial
   * history"), same stub-return shape predictivePersonalRecords already
   * uses. */
  coachingHistory: boolean;
};

export const featureFlags: FeatureFlags = {
  aiCoaching: true,
  recoveryAdaptation: true,
  wearableIntegrations: true,
  videoAnalysis: false,
  voiceCoaching: false,
  predictivePersonalRecords: true,
  coachingMemory: true,
  exerciseIntelligence: true,
  communityChallenges: false,
  nutritionTracking: true,
  coachingHistory: true,
};
