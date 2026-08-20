# AI Coaching Architecture

This document covers the AI-coaching foundation added on top of SetSocial's existing
workout-tracking app: domain models, the coaching engine, feature flags, and what's
deliberately deferred. It's the map for continuing past this pass.

## What shipped this pass

**Phase 1 (foundation) + Phase 2 (readiness & pre-workout adaptation) + Phase 3
(live in-workout set recommendations) + Phase 4 (equipment-aware exercise
substitutions) + Phase 5 (adaptive workout variants) + Phase 6 (post-workout
coaching summary) + Phase 7 (weekly review) + Phase 8 (coaching memory &
habit detection) + Phase 9 (progress timeline) + Phase 10 (PR predictions &
"Future You") + Phase 11 (exercise intelligence beyond metadata)** from the
full product spec. Everything else (video analysis, voice coaching,
wearables, community challenges) is **not built** — see "Deferred phases"
below. No placeholder screens or dead types were added for those; they'll be
designed when their
own pass starts.

## Domain models & database

Two new tables, `supabase/migrations/0012_coaching_readiness.sql`:

- **`readiness_checkins`** — one row per user per calendar day (`unique(user_id, checkin_date)`).
  Sleep hours/quality, soreness, stress, pain flag + notes are user-reported.
  `resting_heart_rate`, `hrv_ms`, `wearable_recovery_score` are reserved, nullable
  columns for a future wearable-sync phase — always `null` today. The coaching
  engine treats `null` as "signal unavailable," never as zero.
- **`workout_adaptations`** — one row per proposed/decided change to a planned
  workout (tied to a `program_day` or a `scheduled_workout`, never neither). Stores
  `original_value`/`updated_value`/`reason`/`confidence`/`source`/`status` per the
  product requirement that adaptations are never applied silently.

A third table, `supabase/migrations/0013_set_recommendations.sql`:

- **`set_recommendations`** — one row per proposed/decided change to the *next set*
  during an active workout (always tied to a `workout_log_id`). Reuses the
  `adaptation_source`/`adaptation_status` enums from 0012 — same "who proposed it,
  what did the user do with it" shape, just scoped to a single set instead of a
  whole planned workout. `recommended_reps`/`recommended_load_kg`/`recommended_rpe`/
  `recommended_rest_seconds` are all nullable since a given recommendation type only
  ever fills in the fields relevant to it (e.g. `increase_rest` only sets
  `recommended_rest_seconds`).

A fourth, `supabase/migrations/0014_exercise_substitutions.sql`:

- **`exercises` gains** `movement_pattern`, `secondary_muscles`, `difficulty`,
  `joint_stress`, `skill_requirement` — all nullable, backfilled for every one
  of the ~61 rows seeded in `0003_seed_exercises.sql` (matched and verified by
  name, one `update ... where name = '...'` per row; any future custom exercise
  a user creates keeps these columns `null`, which the substitution engine
  treats as "unknown," not "none").
- **`exercise_substitutions`** — one row per proposed/decided exercise swap,
  same shape/contract as `set_recommendations`, plus `scope`
  (`workout_only` | `permanent`).
- **No new multi-location "gym profile" table.** `profiles.equipment_access`
  (already collected at onboarding, already editable in `SettingsScreen`)
  remains the single "my equipment" set. A `permanent` substitution just
  removes the flagged equipment type from it via the existing
  `useUpdateProfile` mutation. Named, switchable Home/Commercial/Travel/Hotel
  profiles from the full spec are a real, documented gap — see "Deferred
  phases."

A fifth, `supabase/migrations/0015_workout_variants.sql`:

- **`workout_logs` gains** `variant_type` (nullable `workout_variant_type` enum)
  — records which variant (if any) a session used. Not surfaced in any UI yet
  (weekly review, a later phase, is the natural home for "you did 3 hotel-gym
  workouts this month"-style reporting), but cheap to capture from day one
  rather than backfill later.

**No sixth migration.** The post-workout summary is computed entirely from data
already captured (`workout_log_sets`, `readiness_checkins`, the in-memory
active-workout session) and shown once, right after the workout. Persisting a
snapshot for later replay from workout history is a reasonable future
enhancement, explicitly deferred — see "Deferred phases."

**No seventh migration either.** The weekly review (Phase 7) reuses
`workout_logs`, `workout_log_sets`, `readiness_checkins`, and
`exercises.primary_muscle` — everything it needs already exists.

A sixth (numbered eighth: `0016_training_patterns.sql`), for Phase 8:

- **`training_patterns`** — one row per (user, `pattern_key`) — the "memory"
  a stateless, deterministic detection pass writes into. `pattern_key`
  disambiguates parameterized pattern types, e.g. `inconsistent_weekday:5`
  (Friday) or `rpe_creep:<exerciseId>`. `status` moves `active` →
  `dismissed` (permanent, user-initiated) or `active` → `resolved`
  (evidence no longer supports it, set automatically on the next detection
  run). `first_detected_at` is set once and never touched again;
  `last_detected_at`/`confidence`/`title`/`detail` refresh on every
  detection run that still finds the pattern.

**No ninth migration.** The progress timeline (Phase 9) is a pure
merge-and-sort over `workout_log_sets`/`computePrEvents`, `body_metrics`,
and `workout_logs` — all already captured, nothing new to persist.

**No tenth migration either.** PR predictions (Phase 10) are computed fresh
from `workout_log_sets` on every view, not persisted — unlike Phase 8's
habit patterns, there's no "memory" concept worth storing here: a
projection is a snapshot of the current trend, meant to be recomputed each
time, not accumulated evidence.

**No eleventh migration.** Exercise intelligence (Phase 11) is computed
entirely from metadata columns `0014_exercise_substitutions.sql` already
added (`movement_pattern`, `category`, `difficulty`, `joint_stress`) —
nothing new to capture.

### Deploying the migrations

This project has no linked Supabase CLI project — every prior migration was applied
by hand, and these follow the same path:

1. Open the Supabase Studio SQL Editor for the project.
2. Paste and run, in order: `0012_coaching_readiness.sql`,
   `0013_set_recommendations.sql`, `0014_exercise_substitutions.sql`,
   `0015_workout_variants.sql`, `0016_training_patterns.sql` (0013-0016 all
   reuse enums 0012 defines; 0014's backfill runs against 0003's seed data,
   so seeding must already be applied).
3. `src/types/database.ts` has already been updated by hand to match (new enums,
   `readiness_checkins`/`workout_adaptations`/`set_recommendations`/
   `exercise_substitutions`/`training_patterns` Row/Insert/Update types, the
   `exercises` table's new columns, and `workout_logs.variant_type`) — no
   further action needed there.

No new edge function or secret is required for this pass — readiness scoring and
adaptation are computed entirely client-side by the local rule-based engine.

## Coaching engine

`src/services/coaching/`:

- **`types.ts`** — the `CoachingEngine` interface. This pass implements
  `evaluateReadiness`, `calculateTrainingLoad`, `assessPainRisk`,
  `adaptScheduledWorkout`, `recommendNextSet`, `recommendExerciseSubstitution`,
  `generateWorkoutVariant`, `generatePostWorkoutSummary`,
  `generateWeeklyReview`, `detectTrainingPatterns`, `predictPersonalRecords`,
  and `generateExerciseExplanation`. A later phase adds `generateVoiceCue`
  to this same interface — the UI depends on the interface, never on a
  specific implementation.
- **`engine.ts`** — `LocalCoachingEngine`, a deterministic, rule-based
  implementation. No AI/remote calls. Readiness is a weighted-deduction score
  (0-100) across sleep, soreness, stress, pain, training load, and consistency,
  each factor marked `available: false` when its signal is missing rather than
  silently defaulted to neutral. `adaptScheduledWorkout` and `recommendNextSet`
  are pure functions with no I/O — same inputs always produce the same proposed
  changes.
  - `recommendNextSet` runs a first-match-wins priority chain after every logged
    set: severe decline (reps cratering, or two sets in a row at RPE ≥9.5) →
    `stop_exercise`; a weak manually-added extra set → `remove_last_set`; missed
    the rep target or near failure with sets still planned → `reduce_weight`
    (or `adjust_reps` for bodyweight exercises with no tracked load); RPE
    jumping sharply between sets → `increase_rest`; comfortably hit the top of
    the rep range → `increase_weight`/`adjust_reps` (downgraded to `keep_weight`
    when today's readiness band is already `low`/`very_low` — the one place
    readiness feeds into a set-level decision); right on target → `keep_weight`;
    otherwise `null` (no recommendation is the common case, not a bug).
  - `recommendExerciseSubstitution` scores every candidate in the exercise
    library against the one being replaced: +3 same `movementPattern`, +2 same
    `primaryMuscle`, +1 same `category`, +1 any `secondaryMuscles` overlap, −1
    if `difficulty` differs by two levels (beginner↔advanced). Candidates
    requiring the specifically-flagged-unavailable equipment, or (when an
    equipment allowlist is given) any equipment outside it, are filtered out
    before scoring — `bodyweight` is always allowed. Top 5 by score, score > 0
    only; `[]` is a valid, common answer, not an error. The scoring/filtering
    loop is factored into a private `rankSubstitutes` helper, reused (with an
    extra jointStress-preference toggle) by `generateWorkoutVariant` below —
    one ranking algorithm, not two that could drift.
  - `generateWorkoutVariant` dispatches on `WorkoutVariantType`: `full` is a
    passthrough; `time_45`/`time_30` trim to a minute budget (via
    `estimateWorkoutMinutes`, shared with `TodayScreen`'s day-preview estimate)
    by lightening accessory-exercise sets first, then dropping accessories
    entirely, and only as a last resort lightening compound lifts — a compound
    lift (squat/hinge/lunge/push/pull/carry patterns) is never dropped, which
    is how "preserve the main training objective" is enforced; `hotel` (assumes
    bodyweight/dumbbell/band — a documented typical-hotel-gym guess) /
    `home` (the caller's own `profiles.equipment_access`) / `bodyweight`
    substitute exercises requiring unavailable equipment via `rankSubstitutes`,
    keeping the original with a caveat when no compatible substitute exists;
    `low_readiness` lightens every exercise (sets/RPE down, rest up) the same
    way `adaptScheduledWorkout`'s `low` band does, just user-triggered instead
    of readiness-triggered; `strength_focus`/`hypertrophy_focus` push rep
    ranges and RPE in opposite directions; `reduced_impact` substitutes only
    `jointStress: 'high'` exercises, preferring lower-jointStress candidates.
    Every original exercise gets exactly one `WorkoutVariantChange` entry
    (`'kept'` included, not hidden) — "no changes" is shown, not omitted.
  - `generatePostWorkoutSummary` computes total volume, best set (by e1RM), and
    RPE-target adherence directly from the session's own sets; volume change and
    improved/declined exercises only populate when the caller supplies prior-session
    data per exercise (`previousVolumeByExercise`/`previousBestE1rmByExercise` —
    absent key = no prior data = `null`/omitted output, never a fabricated
    baseline); improved/declined uses a ±2% noise threshold on e1RM so small rep
    variance isn't reported as a trend; recovery guidance combines `trainingLoad`
    classification with average actual RPE; a pain-risk concern (when non-`none`)
    surfaces its `recommendation` text directly, same safety language as
    everywhere else. The synthesized `summary` paragraph and `suggestedNextAction`
    are short deterministic templates, not a live model call — satisfies the
    spec's own "useful even when no remote AI service is configured" requirement.
  - `generateWeeklyReview` computes consistency (`workoutsCompleted /
    (workoutsCompleted + workoutsMissed)`, `null` when nothing was planned),
    total/per-muscle volume, and — per exercise trained that week — a
    "most improved" pick (highest positive % change in this-week best e1RM vs.
    a caller-supplied prior best) and a "most inconsistent" pick (highest
    load coefficient-of-variation, `stdev / mean`, above a 15% noise floor
    among exercises with ≥2 loaded sets; `null` when nothing clears the
    floor). Readiness/sleep/soreness/stress are independent averages over
    the week's check-ins (each field skips checkins where that specific
    value is `null`, rather than treating a missing value as zero).
    `habitObservation` is a first-match-wins priority chain (pain reported →
    low consistency → high stress → low sleep → `null` when nothing stands
    out); `recommendedChangesNextWeek` is always non-empty, same style of
    chain. `shareableSummary` is built from a **separate, narrower** input
    set than `summary` — only `workoutsCompleted`, `totalVolumeKg`,
    `newPersonalRecords.length`, `consistencyPercent` — so there's no code
    path where a private field (readiness, sleep, soreness, stress, pain, or
    any per-exercise detail) can leak into the shareable text; guarded by a
    dedicated regression test.
  - `detectTrainingPatterns` runs a fixed catalog of 5 independent, stateless
    detectors over a caller-supplied multi-week lookback and returns the
    ones that clear threshold, confidence-sorted, with any caller-supplied
    `dismissedKeys` excluded entirely: `inconsistent_weekday` (a weekday
    missed ≥60% of the time, ≥3 opportunities); `declining_consistency`
    (weekly consistency dropped for ≥3 straight weeks; confidence scales
    with the size of the drop); `recurring_pain` (pain in ≥2 of the last 4
    weeks; hedged, non-diagnostic copy, same as every other pain-adjacent
    surface); `rpe_creep` (average working-set RPE for one exercise rose
    ≥1.0 point between the earliest and latest thirds of its sessions in the
    window, *unless* average load also rose >5% — ruling out "harder because
    heavier"); `low_sleep_pattern` (average sleep under 6.5h in ≥3 of the
    last 4 weeks with check-in data). Confidence is **recomputed fresh every
    call** from the current window, not accumulated across calls — the
    engine stays pure and stateless like every other method; the actual
    "memory" (surviving across sessions, permanent dismissal) lives entirely
    in the persistence layer described below, not in the engine.
  - `predictPersonalRecords` fits a deterministic least-squares line through
    each exercise's **daily-best estimated 1RM** over a 90-day lookback
    (same-day sets collapse to that day's max via the new
    `computeE1rmHistories`, `progress.ts`, so a single heavy-set-then-backoffs
    session doesn't skew the fit) and extrapolates 42 days forward. A
    prediction only emits when it clears *all* of: ≥4 qualifying points
    spanning ≥14 days, a positive slope (flat/declining trends never predict
    a "future PR" — that would just read as discouraging noise), R² ≥ 0.3
    (a weak/noisy fit is suppressed rather than shown with false confidence,
    same spirit as Phase 8's confidence floors), and a projected gain of at
    least 1kg (filters trivial, within-noise "predictions"). `confidence` is
    the clamped R²; results sort confidence-descending, same convention as
    `detectTrainingPatterns`. The synthesized `summary` is deliberately
    hedged — "could," "at this pace," "a rough projection... not a
    guarantee" — same posture as every other probabilistic claim in this
    system. Like every other synthesized-text method in this file
    (`generateWeeklyReview`'s `summary`, `generatePostWorkoutSummary`'s
    text), the sentence is written in kg regardless of the viewer's unit
    preference — an existing, accepted simplification, not new to this
    phase; numeric fields (`currentBestE1rm`/`predictedE1rm`) are always kg
    and get unit-converted at display time same as everywhere else.
  - `generateExerciseExplanation` is templated entirely off metadata
    columns already on the `exercises` row — no history, no I/O. `purpose`
    looks up a `Record<MovementPattern, string>` (12 entries), falling back
    to a `Record<ExerciseCategory, string>` (7 entries) when
    `movementPattern` is `null` (custom exercises have no metadata — same
    "unknown, not none" handling Phase 4 established), naming the
    exercise's `primaryMuscle`. `progressionCriteria`/`regressionCriteria`
    branch three ways on `category`: strength categories (`push`/`pull`/
    `legs`/`core`/`full_body`) get load/RPE-based guidance ("add weight
    once every set has reps in reserve" / "drop the weight if you're
    grinding"), `cardio` gets duration/intensity guidance, `mobility` gets
    range-of-motion/hold-time guidance — since "add weight" is meaningless
    for either of those two. When `jointStress === 'high'`, the regression
    text appends a pointer at the "Suitable alternatives" section already
    on the same screen (Phase 4's `recommendExerciseSubstitution`) —
    connecting two features rather than duplicating substitution logic.
- **`index.ts`** — exports the `coachingEngine` singleton the UI imports. This is
  the single swap point for a future remote/AI-backed engine (e.g. a Claude-backed
  edge function, following the same pattern as `chat-coach`/`generate-program`)
  without touching any screen. `recommendNextSet`, `recommendExerciseSubstitution`,
  `generateWorkoutVariant`, `generatePostWorkoutSummary`, and
  `generateWeeklyReview` are gated by `featureFlags.aiCoaching`, the same way
  `adaptScheduledWorkout` is gated by `featureFlags.recoveryAdaptation` (off →
  `generateWorkoutVariant` forces `'full'`; `generatePostWorkoutSummary` still
  runs, but with empty prior-session data and no readiness/pain-risk input, so
  it degrades to volume/best-set/RPE-adherence only; `generateWeeklyReview`
  still runs, but with empty check-ins and no prior-e1RM data, so it degrades
  to workouts/volume/consistency/PRs only — no readiness or habit commentary).
  `detectTrainingPatterns` is gated by its own flag, `featureFlags.coachingMemory`
  (off → `[]`, no exception thrown — the Today screen's insight card simply
  doesn't render when there's nothing to show). `predictPersonalRecords` is
  likewise gated by its own flag, `featureFlags.predictivePersonalRecords`
  (off → `[]` — both the "Future You" card on `ProgressDashboardScreen` and
  the one on `PRDetailScreen` simply don't render). `generateExerciseExplanation`
  is gated by `featureFlags.exerciseIntelligence` (off → `{ purpose: '',
  progressionCriteria: '', regressionCriteria: '' }` rather than `[]`/`null`,
  since a screen calling this always wants a result shape to destructure;
  `ExerciseDetailScreen` only renders the "Why this exercise" card when
  `purpose` is non-empty).

**Safety**: `assessPainRisk` matches pain notes against a small warning-sign
keyword list (chest pain, dizziness, fainting, numbness, shortness of breath). A
match sets `stopAndSeekMedicalAttention: true`, surfaced prominently in
`PreWorkoutReviewScreen` ahead of the "Start Workout" button. All language is
hedged ("appears," "may") and includes an explicit "informational, not medical
advice" disclaimer — the app never claims to diagnose anything.

## Feature flags

`src/config/featureFlags.ts` — a static object, no remote config backend exists
yet. `aiCoaching`, `recoveryAdaptation`, `coachingMemory`,
`predictivePersonalRecords`, and (new this pass) `exerciseIntelligence`
default `true`; every flag for a still-unbuilt subsystem
(`wearableIntegrations`, `videoAnalysis`, `voiceCoaching`,
`communityChallenges`) defaults `false`. Unlike `coachingMemory`/
`predictivePersonalRecords`, `exerciseIntelligence` wasn't pre-seeded in an
earlier pass — this is the first phase to both add and flip its own flag in
the same pass.
`navigateToStartWorkout` (`src/navigation/startWorkoutFlow.ts`) reads
`aiCoaching`: off, "Start Workout" behaves exactly as before this pass (straight to
`LogWorkout`); on, it routes through `PreWorkoutReview` first.

## Analytics

`src/services/analytics/analytics.ts` — no provider is wired up; `trackEvent`
console-logs in dev and no-ops otherwise. Four events fire this pass:
`readiness_viewed`, `workout_adapted`, `adaptation_accepted`,
`adaptation_rejected`. Only counts/enums/booleans are ever passed as props — never
raw pain notes, sleep data, or other check-in content.

## Privacy

`readiness_checkins` and `workout_adaptations` are both RLS-scoped
(`auth.uid() = user_id`, `for all`) — no other user or the anon role can read them.
Analytics never receives raw check-in content. There is no sharing surface for
readiness/pain/adaptation data yet (community features are deferred); when they
ship, this data defaults to hidden per the product privacy requirements.

## Data flow (for a scheduled/program-day workout)

1. User taps "Start Workout" on Today / DayDetail / ScheduledWorkoutDetail →
   `navigateToStartWorkout` → `PreWorkoutReviewScreen`.
2. If no check-in exists for today, a short form collects sleep/soreness/stress/pain
   (or the user can skip it — missing signals just render as unavailable).
3. `useReadinessContext` aggregates today's check-in with data the app already
   fetches elsewhere (`useLoggedSets`, `useWorkoutLogsInRange`,
   `useActiveProgramTree`) into `ReadinessInputs`; the screen calls
   `coachingEngine.evaluateReadiness(inputs)` itself.
4. `coachingEngine.adaptScheduledWorkout(...)` proposes changes (empty array on a
   `high` readiness band). The user accepts/rejects each one, or rejects all via
   "Keep original plan."
5. On "Start Workout," the check-in and each decision are persisted
   (`workout_adaptations.status: 'accepted' | 'rejected'`), then the screen
   navigates to `LogWorkout`.
6. `LogWorkoutScreen` fetches today's accepted adaptations for this source and
   applies each numeric override (`target_sets`, `target_rpe`, `target_load_kg`,
   `rest_seconds`) onto the exercise targets before building the active session,
   and shows an "Adapted for today" banner listing the reasons.

### Live in-workout recommendations (Phase 3)

1. `ExerciseFocusCard` shows a "Last time" caption per exercise, sourced from
   `usePreviousExercisePerformance` — the most recent *other* session's completed
   sets for that exercise (grouped client-side by `workout_log_id` since
   `workout_log_sets` has no session-boundary column to filter on directly).
2. `LogWorkoutScreen` reads today's readiness band once via `useReadinessContext`
   + `coachingEngine.evaluateReadiness` (cache-shared with `PreWorkoutReviewScreen`
   through the same React Query keys — no extra network cost) and passes it down.
3. After a non-warmup set is marked complete, `coachingEngine.recommendNextSet(...)`
   runs against that exercise's completed-sets-so-far and the next planned set
   number (`null` once the last planned set is done). A non-null result renders as
   a card with a type-specific reason, detail line, and Accept/Ignore actions
   (labels vary by type — "Apply to next set," "Add rest," "Remove that set,"
   "Stop this exercise").
4. Accepting applies the recommendation to local state: `updateSetDraft` for
   weight/reps-type recommendations, `startRestTimer` for `increase_rest`, the
   existing set-delete flow for `remove_last_set`, and — for `stop_exercise` —
   removing the remaining undone sets plus a new store action,
   `setExerciseTargetSets`, that caps the exercise's required-set count at what
   was actually done so `isExerciseComplete`/"Finish Workout" reflect the early
   stop instead of blocking on the original target forever.
5. Either way (accept or ignore), `useSaveSetRecommendation` persists one row to
   `set_recommendations` with the final `status` — same "always store the
   decision" contract as Phase 2's adaptations.

### Exercise substitution (Phase 4)

1. `ExerciseFocusCard` shows a "swap" `IconButton` next to the exercise title —
   only while the exercise has zero completed sets, since swapping mid-exercise
   after sets are logged would orphan those `workout_log_sets` rows.
2. Tapping it opens a `BottomSheet` that ranks candidates via
   `coachingEngine.recommendExerciseSubstitution`, using the full exercise
   library (`useExercises('')`) and the viewer's `profiles.equipment_access` as
   the available-equipment set, with the *current* exercise's own equipment
   passed as `excludeEquipment` (the thing that's presumably unavailable right
   now — that's why the user opened the sheet).
3. Selecting a candidate reveals two actions: **"Swap for this workout"**
   (local-only — `activeWorkoutStore.substituteExercise` swaps the exercise's
   identity in place, keeps its `targetSets`/reps/RPE/rest, clears
   `targetLoadKg` since load doesn't transfer to a different movement, and
   rebuilds fresh draft sets) and **"Swap + remove {equipment} from my
   equipment"** (does the same swap, plus updates `profiles.equipment_access`
   via `useUpdateProfile` so future sessions know it's gone too).
4. Either path persists one row to `exercise_substitutions` via
   `useSaveExerciseSubstitution` — same "always store the decision" contract as
   everywhere else in this system.
5. `ExerciseDetailScreen` reuses the identical engine call (browsing context:
   no `excludeEquipment`, equipment list only used as a relevance filter, not a
   hard constraint) to show a "Suitable alternatives" section — the "suitable
   alternatives" exercise-metadata bullet from the spec is served computed,
   on demand, rather than a hand-maintained per-exercise column, since the
   ranking logic already exists and a static list would drift from it.

### Adaptive workout variants (Phase 5)

1. `DayDetailScreen`/`ScheduledWorkoutDetailScreen` show a secondary "Choose a
   workout variant" button next to "Start Workout" (only when
   `featureFlags.aiCoaching` is on) → `navigateToChooseVariant` →
   `ChooseVariantScreen`.
2. That screen fetches the source exercise tree, the full exercise library, and
   the viewer's equipment, merges them into `VariantSourceExercise[]` via the
   shared `buildVariantSourceExercises` helper (`src/utils/variantSource.ts`),
   and computes **all 10** variants up front (cheap, synchronous) so the user
   can compare estimated minutes/exercise counts before picking rather than
   picking blind.
3. **Key design decision**: choosing anything other than "Full Workout"
   navigates straight to `LogWorkout` with `variantType` as a route param,
   *skipping* `PreWorkoutReview` for that session. A deliberate, explicit
   variant choice is already a complete pre-workout decision — running it
   through readiness-based auto-adaptation on top as well would let the two
   systems compound in confusing ways (e.g. an adaptation reducing sets on an
   exercise the variant already dropped). Choosing "Full Workout" (or skipping
   this screen entirely, which is still the default) is unchanged: normal
   `navigateToStartWorkout` behavior, readiness adaptation still applies.
4. `LogWorkoutScreen`'s session-start effect recomputes the same variant
   (`generateWorkoutVariant` is a pure function — same inputs, same output, so
   passing just the `variantType` string through navigation is sufficient; no
   need to serialize a whole computed exercise list through route params) and
   uses its exercise list in place of the raw program/scheduled-workout
   targets, persists `variant_type` on the new `workout_logs` row via
   `useStartWorkoutLog`, and shows a "Variant: {label} — tap to view changes"
   banner (same pattern as the Phase 2 "Adapted for today" banner) listing
   every `WorkoutVariantChange` reason.

### Post-workout coaching summary (Phase 6)

1. "Comparable prior workout" is defined **per exercise**, not per session — a
   `program_day` row is only ever trained once (each week gets its own row), so
   there's no clean "same workout, one week ago" to diff against. This reuses
   Phase 3's `usePreviousExercisePerformance` concept (last time *this exercise*
   was trained), generalized into a new batched hook,
   `usePreviousPerformanceForExercises` — one query for every exercise in the
   just-finished session instead of one query per exercise (hooks can't be
   called in a loop), grouped client-side into `{ volumeKg, bestE1rm }` per
   exercise. Whole-workout volume change is the sum of each exercise's delta.
2. `WorkoutSummaryScreen` computes the summary **before** `onSave`/`store.reset()`
   runs, since it needs `store.exercises` while still in memory. This session's
   new PRs are found by running `computePrEvents` (from `progress.ts`, unchanged)
   over the *complete* history from `useLoggedSets` and keeping only events at or
   after `store.startedAt` — this session's sets are the most recent by
   definition, so a simple timestamp filter is enough; no new PR-tagging
   plumbing needed.
3. Readiness and pain risk are computed the same way `LogWorkoutScreen` already
   does (`useReadinessContext` → `coachingEngine.evaluateReadiness`/`assessPainRisk`),
   cache-shared, no extra network cost.
4. Renders as new `Card` sections **above** the pre-existing rating/RPE/notes
   form, which is untouched — a synthesized summary paragraph up top, a
   danger-styled pain/fatigue concern card when present (same treatment as
   Phase 2's pain warning), new PRs, best set, improved/declined lists, and a
   stats card (volume + change, RPE adherence, readiness vs. performance,
   recovery guidance, suggested next action). Saving still works exactly as
   before — the user's own rating/notes are independent of the computed summary.

### Weekly review (Phase 7)

1. `WeeklyReviewScreen` (reachable from `ProgressDashboardScreen`'s "Weekly
   Review" row) holds a local `weekOffset` state — `0` is the week containing
   today (Monday-start, matching `computeWeeklyVolume`'s existing convention),
   negative moves further back; "Next" is disabled at `0` so the user can
   never navigate into a future week.
2. `useWeeklyReviewData(userId, weekStart, weekEnd)` aggregates
   `useActiveProgramTree`, `useWorkoutLogsInRange`, `useLoggedSets` (existing,
   all-time — filtered client-side to the week for `weekSets`/PR events, and
   to *before* the week for `priorBestE1rmByExercise`), `useExercises('')`
   (for `exerciseId → primaryMuscle`), and the new
   `useReadinessCheckinsInRange` (a ranged sibling to the existing single-day
   `useReadinessCheckin`). `workoutsMissed` walks each day in range via the
   shared `walkScheduledDays` util (`src/utils/trainingScheduleWalk.ts` — see
   Phase 8 below, which extracted it from what used to be an inline copy of
   this same loop), same program-only convention `useReadinessContext`'s
   `missedWorkoutsLast14Days` already uses — ad-hoc scheduled workouts
   aren't "missable." For the current week, the walk stops at today, not
   `weekEnd` (the walker's own built-in "never count a future day" cap).
   Each check-in's `readinessScore` is pre-computed
   by calling `coachingEngine.evaluateReadiness` with just that day's
   check-in — training load/days-since/missed-workouts are all marked
   unavailable (`classification: 'unknown'`, `null`, `0`) rather than
   re-derived for a past day, same "signal unavailable, not zero" handling
   used everywhere else. The hook only aggregates; the screen calls
   `coachingEngine.generateWeeklyReview(params)` itself, mirroring
   `useReadinessContext`'s split.
3. The screen renders the synthesized `summary` up top, a `TrendChart`
   (existing component, no new dependency) of the week's daily readiness
   scores, stat tiles for completed/missed/consistency, a volume-by-muscle
   `ListRow` breakdown, a PR list, most-improved/most-inconsistent cards,
   sleep/stress/soreness averages, pain report count, the habit observation
   (when non-`null`), and next-week guidance.
4. A **separate, visually distinct "Share" card** shows only
   `shareableSummary` with a "Share Summary" button wired to React Native's
   built-in `Share.share({ message })` (no new dependency) — kept physically
   apart from the private detail cards above it so what's shareable is
   obvious at a glance, not just a checkbox easy to miss.

### Coaching memory & habit detection (Phase 8)

1. `src/utils/trainingScheduleWalk.ts` — `walkScheduledDays(program,
   completedDates, from, to)` — a new shared util that factors out the
   `getProgramDayForDate`-per-day loop that used to be copy-pasted inline in
   both `useReadinessContext` (`missedWorkoutsLast14Days`) and
   `weeklyReview.ts` (`workoutsMissed`). Both existing call sites were
   refactored onto it rather than adding a third inline copy for Phase 8's
   own needs; it returns one `{ date, weekday, isTrainingDay, completed }`
   per day, capped at today.
2. `useTrainingPatterns(userId)` (`src/services/api/queries/coachingMemory.ts`)
   aggregates a 6-week lookback: `walkScheduledDays` output grouped into
   `missedWeekdays` (opportunities/missed per weekday, across the whole
   window) and `weeklySnapshots` (one `{ consistencyPercent,
   painReportCount, averageSleepHours }` per Monday-start week, built from
   the same walk plus `useReadinessCheckinsInRange`); and
   `exerciseRpeTrends`, built from a new dedicated raw query,
   `fetchExerciseRpeHistory` — deliberately kept separate from
   `progress.ts`'s `LoggedSet` (which has no `rpe` field) rather than
   widening that shared type and touching every one of its existing call
   sites. It also fetches the user's existing `training_patterns` rows to
   derive `dismissedKeys` and the currently-`active` rows. Returns
   `{ isLoading, activePatterns, params }` — the screen calls
   `coachingEngine.detectTrainingPatterns(params)` itself, same
   hook-aggregates/screen-calls-engine split as every other phase.
3. `useSyncTrainingPatterns()` persists the freshly-detected list: upserts
   (on `user_id, pattern_key`) refresh `confidence`/`title`/`detail`/
   `last_detected_at` for everything still detected, and any previously-
   `active` row whose key *stopped* being detected flips to `resolved`.
   Dismissed rows are never touched by the sync — a dismissal is permanent
   for that pattern key, mirroring the accept/reject contract used
   everywhere else in this system. `TodayScreen` runs the detect-then-sync
   effect (guarded by a content-signature ref so it settles after one
   redundant re-run following the post-sync cache invalidation, rather than
   looping) since Today is the screen every session starts from.
4. `TodayScreen` renders a "Coach Insight" card (only when
   `activePatterns.length > 0`, positioned after the existing contextual
   banner) showing up to 2 patterns by confidence, each with a type icon,
   title, detail, and a dismiss `IconButton` wired to
   `useDismissTrainingPattern`. No dedicated "all insights" screen was
   built — 5 pattern types shown 2-at-a-time already covers the whole
   catalog most of the time, and a browsing screen for a list that's
   usually 0-2 items isn't worth the surface area yet.

### Progress timeline (Phase 9)

Unlike every other phase, this one adds **no `CoachingEngine` method** — a
timeline is "merge and sort things that already happened," not a coaching
judgment call, so the logic lives in a plain util instead of the engine.

1. `useAllWorkoutLogs(userId)` (new, `workoutLogs.ts`) — every completed
   `workout_log` ever, joined with `program_days(title)`/
   `scheduled_workouts(name)` for a display title (falls back to
   `'Workout'` for ad-hoc sessions with neither), descending by
   `completed_at`. The only other workout-log hook,
   `useWorkoutLogsInRange`, is range-bounded — this is the first all-time
   one, alongside the pre-existing all-time `useLoggedSets`/`useBodyMetrics`.
2. `buildProgressTimeline(prEvents, bodyMetrics, workoutLogs)`
   (`src/utils/progressTimeline.ts`, new, pure, hook-free) merges PR events
   (`computePrEvents` over `useLoggedSets`, unchanged), body-metric logs,
   and completed workouts into one reverse-chronological list, and injects
   a `milestone` entry whenever a completed workout's 1-based chronological
   index lands on `[10, 25, 50, 100, 250, 500]` — computed purely from the
   workout list's own ordering, no separate tracking needed.
3. `ProgressTimelineScreen` (new) renders the merged list via `FlatList`
   (matches `ExercisePickerScreen`'s existing use of `FlatList` — no new
   list component), grouped under `MMMM yyyy` month headers computed
   client-side (a flat array of header/entry items, not a `SectionList` —
   unnecessary for this scale). Each row gets a type icon (`trophy`/
   `scale`/`dumbbell`/`medal`); only PR rows are pressable, navigating to
   the existing `PRDetail` route.
4. `ProgressDashboardScreen` gained a "Progress Timeline" `ListRow` next to
   "Weekly Review"/"Body Metrics".

### PR predictions & "Future You" (Phase 10)

1. `computeE1rmHistories(sets)` (new, `progress.ts`) — per exercise, one
   point per calendar day holding that day's best estimated 1RM,
   chronological. Both consuming screens already fetch `useLoggedSets`, so
   there's no new query hook — each just calls `computeE1rmHistories(sets)`
   directly via `useMemo`, then `coachingEngine.predictPersonalRecords(...)`
   itself, same "screen calls the engine" split as everywhere else, just
   without an intermediate aggregation hook since there's only one data
   source this time.
2. `PRDetailScreen` computes the full prediction list and filters to the
   viewed exercise's id, rendering a "Future You" card with the hedged
   `summary` — only when a prediction actually exists for that exercise
   (silently absent otherwise, same "no forced card" discipline as Phase 8's
   insight card).
3. `ProgressDashboardScreen` computes the same full list and surfaces just
   the single top-confidence prediction across all exercises as a "Future
   You" `ListRow` (between "Recent PRs" and the navigation-row card),
   tapping through to that exercise's `PRDetail`.

### Exercise intelligence beyond metadata (Phase 11)

1. `ExerciseDetailScreen` computes `coachingEngine.generateExerciseExplanation({
   exercise: exerciseRowToMetadata(exercise) })` via `useMemo`, mirroring the
   `alternatives` useMemo directly above it (same screen, same
   `exerciseRowToMetadata` conversion Phase 4 already established).
2. A new "Why this exercise" card renders between the existing "How to
   perform it" card and "Suitable alternatives" — purpose text up top, then
   labeled "When to progress"/"When to scale back" sub-sections. Positioned
   so the regression text's alternatives cross-reference (when
   `jointStress` is high) reads naturally pointing down the screen to the
   card that's already there.
3. No new query hook, no target-rep/RPE context — checked both places
   `ExerciseDetail` is reached (`ExercisePickerScreen`, and the screen's own
   alternatives list) and neither passes program-specific targets, so
   `generateExerciseExplanation` takes just the exercise's metadata. A
   future call site could pass target context to sharpen the copy; nothing
   needed that today.

### Home "AI Summary" — today's focus (Phase 12, added post-launch)

Requested after the Social Overhaul shipped: a pre-workout synthesis
card at the top of Home (`TodayScreen`), combining readiness + today's
specific plan + recent performance into one short paragraph — something
none of the existing generators did (`readiness.summary` is readiness-only;
`generatePostWorkoutSummary` needs completed sets and only runs after a
workout).

1. `coachingEngine.generateTodayFocusSummary(params)` — new method,
   `src/services/coaching/engine.ts`/`types.ts`. Pure composition, same
   `parts: string[]` → `join(' ')` pattern as `buildPostWorkoutSummaryText`:
   an opening sentence from `TodayPlanContext` (`rest_day` /
   `training_day` / `scheduled` / `completed` / `none`), then
   `readiness.summary` verbatim plus an RPE-target clause (only for
   `training_day`/`scheduled` plans — never re-derives readiness's own
   factor logic), then at most one contextual clause in priority order
   `missedYesterday > recentPr > isMilestoneWeek > streak > 2`. Gated at
   the `coachingEngine` wrapper (`src/services/coaching/index.ts`), same
   as every other method — returns an empty result when
   `featureFlags.aiCoaching` is off, rather than the UI checking the flag
   itself.
2. `src/screens/home/AiSummaryCard.tsx` (new, co-located with
   `WeekTimeline`) — renders the headline/summary, an icon from the
   readiness band, `null` when there's nothing to show.
3. `TodayScreen.tsx` now also calls `useReadinessContext(userId)` (already
   built for `PreWorkoutReviewScreen` — shares query keys, no extra
   network cost beyond one new `readinessCheckin` query) and builds a
   `TodayPlanContext` from data it already computes for **today**
   specifically (not whatever day is selected on the calendar).
4. **The old inline "contextual banner"** (missed-yesterday / recent-PR /
   deload / milestone-week, one icon+title+subtitle at a time) was
   **removed** — its signals are exactly what feed the new summary's
   contextual clause, so keeping both would show the same fact twice on
   one screen.

See `docs/social.md` for the same pass's Home reorder (Friends Activity
moved below the workout-summary card) and pull-to-refresh.

## Known limitation: `recovery_replacement`

There's no exercise-substitution or mobility-session catalog yet (that's a later
phase). When readiness is `very_low` or pain risk is `severe`, the engine still
emits a `recovery_replacement` marker (shown as the headline recommendation) but,
since there's no real recovery content to swap in, it also emits an aggressive
numeric pullback (roughly half the sets, RPE −2, +45s rest) on the existing
exercises so accepting the recommendation has a real, visible effect in
`LogWorkoutScreen` rather than silently doing nothing.

## Known limitation: no mid-set pain report

There's no dedicated "report pain on this set" affordance. Pain safety is
handled pre-workout (Phase 2's check-in); a severe within-set decline (reps
cratering, two RPE≥9.5 sets in a row) already routes `recommendNextSet` to
`stop_exercise` without needing separate pain-specific UI. A first-class pain
button can be added later without changing this design.

## Known limitation: single equipment set, no named locations

The full spec describes distinct, switchable Home/Commercial/Travel/Hotel
equipment profiles. This pass builds substitution matching entirely on top of
the single `profiles.equipment_access` set that already existed (onboarding +
Settings) rather than adding a parallel multi-location system — see the Phase 4
scope note above. A user who trains in more than one place with different
equipment can't currently switch between saved equipment sets; every substitution
decision reads/writes the one global set.

## Known limitation: workout variants aren't offered for templates

`ChooseVariantScreen` is only reachable from `DayDetailScreen` and
`ScheduledWorkoutDetailScreen` (program days and scheduled workouts) —
matching exactly where "Start Workout" already lives. Freestyle sessions and
workout-template starts don't offer a variant picker. `generateWorkoutVariant`
itself doesn't care about the source (it operates on plain exercise targets),
so wiring a third entry point later is a small, additive change, not a
redesign.

## Known limitation: no persisted summary history

The post-workout summary is generated fresh each time and shown once — nothing
is stored beyond the `workout_log_sets`/PR data it was computed from. There's
no way to reopen a past workout and see its coaching summary again. Adding a
persisted snapshot (e.g. a `coaching_summary` column or table on `workout_logs`)
is a reasonable follow-up, not built now since nothing in this pass's UI needs
to replay it.

## Known limitation: weekly review has no multi-week trending

`averageReadinessScore`/`averageSleepHours`/`averageSoreness`/`averageStress`
are each week's own averages, not compared against a longer historical
baseline — there's no "your sleep is trending down over the last month"
insight yet. Computing a true multi-week trend would need reconstructing
`trainingLoad`/`missedWorkouts` context for every past day, which isn't
worth the complexity for what's fundamentally a per-week summary. Similarly,
`habitObservation` is a single, non-persisted, one-week heuristic
("discomfort came up twice this week," "a few sessions were missed") —
explicitly *not* the cross-week, confidence-scored pattern memory Phase 8's
`detectTrainingPatterns` builds. The two are independent: `habitObservation`
doesn't feed into pattern detection or persist anywhere, and
`detectTrainingPatterns` doesn't read weekly-review output — both derive
their own inputs from the same underlying logged/check-in data.

## Known limitation: coaching memory is a fixed 5-pattern catalog

`detectTrainingPatterns` is not an open-ended "detect anything" system —
it's exactly the 5 pattern types documented above, each independently
simple and deterministic. There's no mechanism for the catalog to grow
itself (e.g. no generic anomaly detection, no AI-proposed new pattern
types), and no incremental/EMA confidence tracking across historical runs —
confidence is always recomputed fresh from the current 6-week window.
Volume-plateau detection ("your numbers have been flat for weeks") was
considered and deliberately cut from the catalog: its threshold is fuzzier
than the other 5 and it overlaps in spirit with `declining_consistency` and
Phase 7's `mostImprovedExercise`. Adding a 6th pattern type later is a
small, additive change (one detector function plus one enum value), not a
redesign. There's also no dedicated "all insights" browsing screen — only
the top 2 (by confidence) surface on `TodayScreen`; a resolved or dismissed
pattern's history isn't visible anywhere in the UI, only in the
`training_patterns` table itself.

## Known limitation: progress timeline scope

Adaptation/substitution history and program-started/-completed milestones
are deliberately absent — see the Phase 9 scope note above (noise/overlap
with Phase 8, and no timestamped status-transition log to derive an
accurate completion date from, respectively). The screen fetches all-time
data in one shot (no pagination), matching this codebase's existing
`useLoggedSets`/`useBodyMetrics`/`computePrEvents` convention rather than
introducing a new infinite-scroll pattern nothing else in the app uses yet
— fine at expected personal-fitness-app data scale, worth revisiting if it
ever becomes a real performance problem. Workout-completed rows aren't
tappable to a detail view since no workout-history detail screen exists in
the app yet.

## Known limitation: PR predictions are naive linear extrapolation

`predictPersonalRecords` fits a straight line and projects it forward —
there's no cap on how far a strong short-window trend can extrapolate
beyond what the four emit-guards (point count, span, R², minimum gain)
already filter, and no attempt to model plateaus, deloads, or the natural
slowing of gains over a lifter's training age. This is a deliberate
simplification consistent with the rest of the engine's rule-based, no-AI
philosophy — it's a rough trend projection, not a strength-science model,
and the copy says so ("a rough projection... not a guarantee"). Predictions
also aren't persisted (see the migrations section above) — there's no
history of past predictions to check accuracy against, and no per-exercise
dismissal like Phase 8's patterns have; a low-quality projection simply
stops appearing once the underlying trend data no longer supports it.

## Known limitation: exercise intelligence copy is per-category, not per-exercise

`generateExerciseExplanation`'s progression/regression guidance branches on
`category` (3 families: strength/cardio/mobility) and `movementPattern`/
`jointStress` for flavor, not on the specific exercise — two very different
`legs` exercises (e.g. a barbell back squat and a leg-extension isolation
move) get the same load/RPE-based progression template even though real
coaching advice would differ more per exercise. This is a deliberate
template-count tradeoff (a fixed, reviewable set of templates vs. one
bespoke paragraph per exercise, which would either mean hand-authoring
~60+ entries or reaching for an AI call this phase deliberately avoids).
`skillRequirement` and `difficulty` are captured on every exercise but
aren't read by this method yet — a reasonable next refinement, not built
now since the category/pattern/jointStress signals already cover the
highest-value distinctions (load-based vs. not, and when to point at
substitutions).

## Deferred phases (not built this pass)

Named multi-location equipment profiles · video analysis · voice coaching ·
wearable integrations · community challenges & fair leaderboards.

Each should get its own inspect → plan → implement pass rather than being sketched
in alongside this one, per the product spec's own instruction to prioritize a
working vertical slice over broad, shallow coverage.

## Testing

- `src/services/coaching/__tests__/engine.test.ts` — unit tests for
  `evaluateReadiness` (band thresholds, missing-signal handling),
  `calculateTrainingLoad`, `assessPainRisk` (including the severe-keyword path),
  `adaptScheduledWorkout` across all readiness bands, `recommendNextSet` across
  all seven outcome types plus the null/no-signal case,
  `recommendExerciseSubstitution` (ranking priority, equipment filtering
  including the always-allow-bodyweight rule, the difficulty-gap penalty, and
  the empty-candidates case), and `generateWorkoutVariant` (full passthrough;
  time-budget trimming that lightens/drops accessories before ever touching a
  compound lift, and only lightens compounds as a last resort; equipment
  substitution for hotel/home/bodyweight including the no-substitute-found
  caveat path; low-readiness/strength/hypertrophy numeric shifts; joint-stress
  substitution for reduced-impact), and `generatePostWorkoutSummary` (volume
  totals and the "no prior data → null change" case, best-set selection across
  exercises, improved/declined classification against the noise threshold, RPE
  adherence math, readiness-vs-performance text presence/absence, all three
  recovery-need classifications, and pain-concern pass-through), and
  `generateWeeklyReview` (consistency math including the no-planned-days →
  `null` case, volume-by-muscle grouping, most-improved selection,
  most-inconsistent CV threshold including the no-qualifier → `null` case,
  readiness/sleep/stress/soreness averaging with partial data, pain-report
  counting, habit-observation priority order, and — explicitly — that
  `shareableSummary` never contains any of the private fields' values), and
  `detectTrainingPatterns` (one test per pattern type covering its emit
  threshold including the just-under case — the weekday ratio floor, the
  3-week decline run, the pain-week count, the RPE-creep-vs-load-increase
  distinction, the low-sleep-week count — plus the `dismissedKeys` filter
  and confidence-descending sort order across multiple simultaneous
  matches), and `predictPersonalRecords` (emits for a clear, well-fit
  upward trend; independently suppressed by each of the four guards —
  too few points, too-short span, flat/declining slope, weak R², and a
  well-fit-but-negligible projected gain; confidence tracks R²; multiple
  qualifying exercises sort by confidence descending), and
  `generateExerciseExplanation` (purpose text varies by movement pattern,
  mentions the primary muscle, and falls back to a category-based purpose
  when movement pattern is `null`; progression/regression guidance differs
  across the three category families — strength/cardio/mobility — with the
  cardio case explicitly asserted to *not* mention adding weight; the
  suitable-alternatives pointer appears in the regression text only when
  `jointStress === 'high'`).
- `src/services/api/queries/__tests__/progress.test.ts` (new) —
  `computeE1rmHistories`: same-day sets collapse to that day's max e1RM,
  points come out chronologically ordered across days, different exercises
  stay in separate histories, and sets with no recorded load are ignored.
- `src/utils/__tests__/trainingScheduleWalk.test.ts` (new) —
  `walkScheduledDays` correctness: weekday tagging, rest days marked
  not-training, the `completed` flag matching a caller-supplied date set,
  no-active-program treating every day as not-training, and the future-day
  cap (via `jest.useFakeTimers` to pin "today" deterministically) — this
  util is now shared by three call sites, so its own test coverage matters
  more than when the same logic was inline in just one of them.
- `src/screens/log/__tests__/PreWorkoutReviewScreen.test.tsx` — component test
  covering the readiness score rendering, accept/reject toggling, and the
  "Start Workout" → `LogWorkout` navigation call.
- `src/screens/log/__tests__/LogWorkoutScreen.test.tsx` — component test seeding
  `useActiveWorkoutStore` directly (bypassing the async session-start effect):
  completing a set and asserting the recommendation card/accept/ignore flow
  persists via `useSaveSetRecommendation`; opening the substitute-exercise sheet,
  picking a candidate, and asserting both the "workout only" and "permanent"
  scopes update the store/profile correctly and persist via
  `useSaveExerciseSubstitution`; that the swap button disappears once a set
  is completed; and (this pass) a *cold-start* case — empty store, a
  `variantType` route param — asserting the session hydrates with the
  variant's exercise list, persists `variant_type`, and shows the variant
  banner.
- `src/screens/log/__tests__/ChooseVariantScreen.test.tsx` (new) — all 10
  variants render with their computed label/estimate, picking a non-`full`
  variant navigates straight to `LogWorkout` with `variantType` set (no
  `PreWorkoutReview` hop), and picking `full` goes through the normal
  `navigateToStartWorkout` path.
- `src/screens/log/__tests__/WorkoutSummaryScreen.test.tsx` (new — the screen
  had no test file before this pass) — the mocked coaching summary renders
  (new PRs, best set, improved/declined, stats), and "Save Workout" still
  calls `useCompleteWorkoutLog`, resets the session, and navigates home exactly
  as before — regression-guarding the pre-existing, untouched save flow.
- `src/screens/progress/__tests__/WeeklyReviewScreen.test.tsx` (new) — mocked
  review data renders the summary and stat cards, pressing "Previous week"
  changes the displayed header from "This Week" to "Week of {date}", and
  pressing "Share Summary" calls `Share.share` with exactly the
  `shareableSummary` text (not the full private summary) — a component-level
  regression guard on the same privacy requirement the engine test covers.
- `src/screens/home/__tests__/TodayScreen.test.tsx` (new — the screen had no
  test file before this pass) — mocked active patterns render in the "Coach
  Insight" card, and pressing a pattern's dismiss button calls
  `useDismissTrainingPattern` with that pattern's id.
- `src/utils/__tests__/progressTimeline.test.ts` (new) — empty input
  produces an empty timeline; PRs/body-metrics/workouts merge and sort
  descending by date; a milestone entry lands on exactly the Nth completed
  workout (not off by one, and absent below the threshold); one timeline
  entry per completed workout regardless of milestone status.
- `src/screens/progress/__tests__/ProgressTimelineScreen.test.tsx` (new) —
  mocked merged data renders under the right month header, and pressing a
  PR row navigates to `PRDetail` with that PR's `exerciseId`.
- `src/screens/progress/__tests__/PRDetailScreen.test.tsx` (new — the
  screen had no test file before this pass) — the "Future You" card
  renders when the mocked engine returns a prediction for the viewed
  exercise, and is absent entirely when it doesn't.
- `src/screens/exercises/__tests__/ExerciseDetailScreen.test.tsx` (new —
  the screen had no test file before this pass) — the "Why this exercise"
  card renders the mocked purpose/progression/regression text from
  `generateExerciseExplanation`.
- `@testing-library/react-native` (+ its `test-renderer` peer) added as
  devDependencies since the repo had no component-test tooling before Phase 2.
  Getting Jest working at all also required three infrastructure fixes,
  unrelated to coaching logic but necessary to run any test in this repo:
  `@react-native/jest-preset` was referenced in `jest.config.js` but never
  installed; Reanimated 4's official Jest mock touches native worklets bindings
  that don't exist under Jest, replaced with a minimal manual mock at
  `__mocks__/react-native-reanimated.js`; and `transformIgnorePatterns` had to
  be opened up for the ESM-heavy RN dependency tree (date-fns, lucide-react-native,
  async-storage, image-picker, etc.).

## Environment variables

None added. No new edge function, no new secret.

## Native permissions

None added. Readiness check-in is a plain form; no camera/mic/health APIs.
