# Coaching History & Trends — Plan

**Status: plan only. Nothing past Phase 1 is built.** Same discipline as
`docs/ai-coaching.md`/`docs/social.md`/`docs/apple-health.md`: one phase
planned, reviewed, and explicitly approved before any code is written.
**Phase 1 (persisted post-workout summaries) has shipped.** Phase 2
(multi-week trending) is now planned in full below, ready for review —
still no code written for it yet, waiting on approval the same way Phase 1
did.

This closes two gaps `docs/ai-coaching.md` names explicitly: "no persisted
summary history" and "weekly review has no multi-week trending."

## Why persistence, if recomputing is cheap

Worth stating plainly, since it's not the obvious reason: `generatePostWorkoutSummary`
and `generateWeeklyReview` are both **cheap** to recompute — a single pass
over already-fetched sets/check-ins, no expensive I/O. Persistence isn't
about performance. It's about two different things, one per feature:

- **Post-workout summaries: faithful point-in-time replay.** `volumeChangeKg`/
  `mostImprovedExercise`/etc. are computed relative to *prior* sessions at
  the moment the workout finished. Recomputing the same summary later would
  compare against a **different, larger** set of "prior" sessions (more
  workouts have happened since) and produce a different answer than what
  the athlete actually saw right after training. Only persisting the exact
  result preserves what was really shown.
- **Multi-week trending: a cheap read path for a rolling window.** A trend
  needs 6 weeks of `averageReadinessScore`/etc. Reconstructing all six
  weeks' full engine inputs (workout logs, check-ins, previous e1RMs) every
  time `WeeklyReviewScreen` renders is the real cost this avoids — one
  persisted numeric row per past week is a cheap read; six live
  recomputations are not.

## Placement — no new tab, one new pushed screen, one existing screen extended

Investigated `MainTabs.tsx`/`ProgressStack.tsx`/`ProgressDashboardScreen.tsx`
directly. `ProgressStack` is `ProgressDashboard` (initial route) → `PRDetail`,
`BodyMetrics`, `WeeklyReview`, `ProgressTimeline` — all pushed off the
dashboard. `ProgressDashboardScreen` already has exactly the right shape
for this: one `Card` with three stacked `ListRow`s ("Weekly Review",
Pro-gated → `WeeklyReview`; "Body Metrics" → `BodyMetrics`; "Progress
Timeline", Pro-gated → `ProgressTimeline`).

**Post-workout history** gets a **4th row in that same card** — "Coaching
History," Pro-gated (same tier as Weekly Review/Progress Timeline, its
closest siblings in depth/scope) → a new `CoachingHistory` route in
`ProgressStack`. No new tab, no new top-level nav item, entered exactly the
way its two closest siblings already are.

**Multi-week trending** needs **no new navigation at all** — it's a gap
*inside* `WeeklyReviewScreen` specifically (confirmed: `weekOffset` state →
`useWeeklyReviewData` → `coachingEngine.generateWeeklyReview`, recomputed
fresh on every week change, nothing persisted or trend-aware today). It
becomes a new card on that existing screen, reached the one existing way
`WeeklyReviewScreen` already is.

**Why not fold history into `ProgressTimelineScreen` instead?** That screen
is a pure client-side merge-and-sort of already-happened events (PRs, body
metrics, workouts) with no per-type screen of its own — injecting a
stateful "browse my coaching summaries" concept there would break its
single-purpose contract. Its `workout_completed` rows aren't even wired to
navigate anywhere today (`onPress={undefined}`, confirmed). The dashboard's
existing "secondary destinations" card is the established, lower-risk slot.

**Existing workout-detail screen doesn't fit — a small new screen is
needed.** `WorkoutLogDetailScreen` (`ProgramsStack`, reached only from
`CalendarScreen`) does exist, but it's an **editable per-set breakdown**
(reps/load/RPE fields, delete set/workout), locked read-only only after a
day passes — a completely different purpose from replaying a synthesized
narrative, and it lives in the wrong stack (Programs, not Progress). Phase
1 needs one new, small, **read-only** `CoachingSummaryDetail` screen in
`ProgressStack` that renders a persisted `PostWorkoutSummaryResult` — most
of its presentational pieces already exist as the cards `WorkoutSummaryScreen`
renders live; this reuses that rendering against a persisted row instead of
a freshly-computed one, not a rewrite of anything.

**Not in scope for `CoachingHistoryScreen`**: weekly reviews. `WeeklyReviewScreen`
already fully owns browsing weekly reviews via Previous/Next — duplicating
that into a second list would be redundant surface area, not added value.

## Schema

### Phase 1 — `coaching_summaries` (next migration: `0080`)

A **dedicated table**, not a `workout_logs` column (the option
`docs/ai-coaching.md` floated). Reasoning: every migration in the
`0012`-`0016` range that needed to store a *structured* coaching artifact
(`workout_adaptations`, `set_recommendations`, `exercise_substitutions`,
`training_patterns`) used its own table, FK'd back to `workout_logs`/
`program_days` — that's the dominant precedent, not the one exception
(`0015`'s `variant_type`, a single small enum column, not a structured
payload). `PostWorkoutSummaryResult` has arrays (`newPersonalRecords`,
`improvedExercises`, `declinedExercises`) and nested objects (`bestSet`,
`rpeAdherence`) — exactly the shape a dedicated table with a `jsonb`
payload fits, and `workout_logs` has never held a `jsonb` column; every
past addition to it was a scalar. Keeping the coach's synthesized output
in its own table also matches this codebase's existing separation of "the
log" from "what the coach concluded about it."

```sql
create table public.coaching_summaries (
  id uuid primary key default gen_random_uuid(),
  workout_log_id uuid not null unique references public.workout_logs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  summary jsonb not null,
  created_at timestamptz not null default now()
);
```

`unique (workout_log_id)` enforces "written once at completion" — a
second `generatePostWorkoutSummary` call for the same workout (shouldn't
happen, but) would need to explicitly upsert or fail, not silently
duplicate. `user_id` is denormalized (present directly, not only reachable
via `workout_log_id` → `workout_logs.user_id`) because this table is read
**standalone** ("show me my history," not "show me this one workout's
summary") — the one table in this schema queried the same way
(`workout_log_sets`) omits `user_id` specifically because it's *never*
read standalone, always joined through `workout_logs`. `coaching_summaries`
is the opposite access pattern, so it gets the opposite schema choice.
RLS: `coaching_summaries_all_own`, the standard `auth.uid() = user_id`
`for all` policy every table in this codebase already uses.

### Phase 2 — `weekly_review_summaries` (migration `0081`, next available)

```sql
create table public.weekly_review_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  week_start date not null,
  summary jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index weekly_review_summaries_user_id_week_start_key
  on public.weekly_review_summaries (user_id, week_start);
-- RLS: weekly_review_summaries_all_own, standard auth.uid() = user_id.
```

**Upsert-on-view, not write-once** — the opposite of `coaching_summaries`,
deliberately. A week isn't final the moment it starts the way a workout is
final the moment it's saved: viewing "this week" on Wednesday and again on
Sunday should reflect Sunday's fuller picture, not freeze at Wednesday's
partial one. Every `WeeklyReviewScreen` view (past or current week)
recomputes via the engine and upserts on `(user_id, week_start)`. Once a
week is fully past, later views just re-write the same values — harmless,
no special "finalize" step needed. `week_start` uses the same Monday-start
convention `computeWeeklyVolume` already established (`docs/ai-coaching.md`
Phase 7) — no ISO-week concept exists anywhere in this schema yet, so this
is the first table to need one, and it inherits the app's own existing
convention rather than introducing a second one (e.g. Sunday-start).

## Multi-week trending (Phase 2)

Per the explicit ask: a rolling window compared against the current week,
surfaced as a direction, not a new statistical model. **This is a
genuinely simpler question than `predictPersonalRecords` answers** — "is
this week higher/lower/flat vs. my recent baseline" doesn't need a
regression fit the way "where is this trend heading" does. Matching
`predictPersonalRecords`' posture here means copying its **restraint and
guard-then-hedge discipline**, not its math.

### New engine types (`src/services/coaching/types.ts`)

```ts
export type ReadinessTrendDirection = 'up' | 'down' | 'flat';

/** null = insufficient data (< MIN_QUALIFYING_WEEKS), never fabricated
 * as 'flat' — see the emit-guard below. */
export type MetricTrend = {
  direction: ReadinessTrendDirection;
  currentValue: number;
  baselineValue: number; // mean of qualifying prior weeks
  qualifyingWeeks: number; // out of ROLLING_TREND_WEEKS
} | null;

export type ReadinessTrendResult = {
  readiness: MetricTrend;
  sleep: MetricTrend;
  soreness: MetricTrend;
  stress: MetricTrend;
};

/** One persisted week's four averages — a narrow projection of
 * WeeklyReviewResult, not the whole persisted blob, same "pass only what's
 * needed" posture buildShareableWeeklySummary's own narrow struct already
 * established for a different reason (there, privacy; here, just not
 * over-fetching six rows' worth of PR lists/muscle breakdowns nothing here
 * reads). */
export type WeeklyTrendPoint = {
  weekStart: string;
  averageReadinessScore: number | null;
  averageSleepHours: number | null;
  averageSoreness: number | null;
  averageStress: number | null;
};

export type CalculateReadinessTrendParams = {
  currentWeek: WeeklyTrendPoint;
  /** Up to ROLLING_TREND_WEEKS prior weeks, any order — the engine sorts
   * and windows internally, callers just pass what useRecentWeeklyReview
   * Summaries returned. */
  priorWeeks: WeeklyTrendPoint[];
};
```

`calculateReadinessTrend(params): ReadinessTrendResult` joins
`CoachingEngine`'s interface as a **new, separate method** — not a change
to `generateWeeklyReview`'s params or return shape. This is required, not
a style preference: persistence/trending must not change the existing
pure-function contracts `generatePostWorkoutSummary`/`generateWeeklyReview`
already have. `WeeklyReviewScreen` calls it separately, alongside
`generateWeeklyReview`.

### Engine constants and logic (`engine.ts`)

```ts
const ROLLING_TREND_WEEKS = 6; // matches Phase 8's training_patterns lookback
const MIN_QUALIFYING_WEEKS = 3; // out of ROLLING_TREND_WEEKS
const READINESS_FLAT_BAND = 5; // points, 0-100 scale
const SLEEP_FLAT_BAND = 0.5; // hours
const SORENESS_STRESS_FLAT_BAND = 0.5; // 1-5 scale
```

Per metric, independently: take up to the 6 most recent `priorWeeks` with
a non-null value for that metric; if fewer than `MIN_QUALIFYING_WEEKS`
qualify, that metric's `MetricTrend` is `null` (not `'flat'` — a
`'flat'` result must never be the answer for "not enough data," since
that would misrepresent absence as a real, no-change signal). Otherwise,
`baselineValue` is the mean of qualifying weeks, and `direction` is
`'flat'` if `|currentValue - baselineValue|` is within that metric's band,
else `'up'`/`'down'`. No R², no confidence score — there's no fitted line
to have confidence *in*; the guard here is the data-sufficiency check, not
a goodness-of-fit measure.

### Gating (`src/services/coaching/index.ts`)

Reuses the `coachingHistory` flag Phase 1 already added and flipped
(stub-return shape, matching `predictPersonalRecords`): off →
`calculateReadinessTrend` returns `{ readiness: null, sleep: null,
soreness: null, stress: null }`.

### Query layer

`src/services/api/queries/weeklyReview.ts` (extended, not a new file —
this is the file that already owns weekly-review data fetching):

- **`useSaveWeeklyReviewSummary()`** — upsert mutation on `(user_id,
  week_start)`, called from `WeeklyReviewScreen` every time `review`
  changes for the currently-viewed week (fire-and-forget, same
  best-effort posture Phase 1's `useSaveCoachingSummary` call site
  already established — a failed write means that week's trend input is
  stale, not a broken screen).
- **`useRecentWeeklyReviewSummaries(userId, beforeWeekStart)`** — reads up
  to `ROLLING_TREND_WEEKS` persisted rows with `week_start <
  beforeWeekStart`, ordered descending, mapped to `WeeklyTrendPoint[]` by
  pulling just the four average fields out of each row's jsonb `summary`
  (not the whole `WeeklyReviewResult` — see the narrow-projection note on
  `WeeklyTrendPoint` above).

### `WeeklyReviewScreen.tsx` integration

- After `review` is computed (existing `useMemo`, unchanged), a new
  `useEffect` calls `useSaveWeeklyReviewSummary().mutate({ userId,
  weekStart, summary: review })` whenever `review`/`weekStart` change.
- `useRecentWeeklyReviewSummaries(userId, weekStart)` fetches the rolling
  window; `coachingEngine.calculateReadinessTrend({ currentWeek: {
  weekStart: ..., averageReadinessScore: review.averageReadinessScore,
  ... }, priorWeeks: recentSummaries })` is computed via `useMemo`.
- **New component `src/screens/progress/ReadinessTrendCard.tsx`**
  (co-located, screen-specific, matching the existing `WhoopMetricsSection.tsx`/
  `OuraMetricsSection.tsx` precedent for a screen-owned presentational
  piece) — pure props-in, takes a `ReadinessTrendResult` and renders one
  row per non-null metric (label, `trendingUp`/`trendingDown`/`minus`
  icon, "up/down/flat vs. your last N weeks" caption). Renders nothing
  (not an empty card) when all four are `null` — same "simply doesn't
  render when there's nothing to show" precedent Phase 8's Coach Insight
  card already set.
- Placed directly after the existing "Daily readiness" `TrendChart` card —
  the natural adjacent slot, both readiness-scoped.

### Testing

- `engine.test.ts` extended: `calculateReadinessTrend` — direction at,
  just inside, and just outside each metric's band; the
  `MIN_QUALIFYING_WEEKS` emit-guard at exactly 2-of-6 (suppressed, `null`)
  vs. 3-of-6 (emitted) qualifying weeks; independence across the four
  metrics (one qualifying while another doesn't); off-flag stub-return.
  Extends the existing shareableSummary persist-then-reload regression
  test from Phase 1's plan (still applies unchanged here).
- `WeeklyReviewScreen.test.tsx` extended: the trend card renders each
  direction correctly from mocked engine output; absent entirely when the
  mocked result is all-`null`; the upsert-save mutation is called with the
  currently-viewed week's `weekStart` and the computed `review` on both
  initial render and after navigating to a different week.

## Feature flag

Two existing gating shapes are already in use in this engine — degraded-
input (`generatePostWorkoutSummary`/`generateWeeklyReview`: flag off →
inputs zeroed, engine still runs, output degrades) and stub-return
(`predictPersonalRecords`: flag off → `[]`). A new flag, `coachingHistory`,
uses the **stub-return** shape: off → `calculateReadinessTrend` returns
`null`/persistence writes don't happen/`CoachingHistoryScreen`'s row is
simply absent from the dashboard card. Degraded-input doesn't make sense
here — there's no meaningful "partial trend" or "partial history," unlike
a summary that can sensibly drop to volume-only. Defaults `true`, flipped
in the same pass that ships Phase 1 — same precedent `exerciseIntelligence`
already set ("first phase to both add and flip its own flag").

## Privacy

**No change to the `shareableSummary` boundary — persistence is orthogonal
to it.** `buildShareableWeeklySummary` already builds `shareableSummary`
from a deliberately narrow, separate parameter struct
(`workoutsCompleted`/`totalVolumeKg`/`prCount`/`consistencyPercent`/
`unitPref` only) — it's structurally incapable of seeing readiness, sleep,
soreness, stress, pain, or per-exercise data, because those were never
passed in. That enforcement happens at **construction time**, before
persistence ever enters the picture. Persisting the full `WeeklyReviewResult`
(including the already-safe `shareableSummary` string inside it) doesn't
widen who can read it — `weekly_review_summaries` gets the exact same
`auth.uid() = user_id` RLS every private table in this app already has, so
the audience for the persisted row is identical to the audience for the
live-computed one today: nobody but the owner. The one thing this phase
adds is a regression test (see Testing) confirming a **persisted-and-reloaded**
`shareableSummary` still passes the existing leak-check regex — guarding
against a hypothetical future bug in the read path, not a gap in the
current design.

## Read path

`CoachingHistoryScreen`: all-time list of `coaching_summaries` rows for
the signed-in user, newest first, each row showing the workout's date and
the summary's headline (`summary` text or a short derived label) — same
"all-time, no pagination" convention `docs/ai-coaching.md` already
documents for `ProgressTimelineScreen` at this app's data scale, flagged
the same way to revisit if it ever becomes a real problem. Tapping a row
pushes `CoachingSummaryDetail`, which renders the persisted
`PostWorkoutSummaryResult` using the same presentational pieces
`WorkoutSummaryScreen` already has for a live one.

`WeeklyReviewScreen`: a new trend card (up/down/flat per available metric,
absent metrics simply not shown) appears alongside the existing readiness
chart and stat tiles — inherits the screen's existing Pro gate, no separate
gating decision needed.

## Known limitations

### Phase 1

- **No backfill.** Summaries only start persisting for workouts completed
  after this ships — same convention `training_patterns` (Phase 8) already
  set for "no retroactive detection." Workouts before this ships never get
  a `CoachingHistoryScreen` entry.
- **Immutable by design, which is also a real limitation.** A persisted
  summary reflects the engine's logic *at the time it was written* — if
  `generatePostWorkoutSummary`'s templates or thresholds change later, old
  entries keep showing old text/numbers rather than updating to match. This
  is the deliberate point-in-time-replay behavior described above, but an
  athlete comparing an old and new summary side by side may notice the
  difference and find it confusing without some explanation.
- **No delete-just-the-summary action.** `coaching_summaries` cascade-
  deletes when its `workout_log` is deleted (existing delete flow in
  `ProgressTimelineScreen`/elsewhere), but there's no standalone "remove
  this summary" UI in `CoachingHistoryScreen` itself this phase.
- **No pagination** — see "Read path" above.

### Phase 2

- **Four metrics only** (readiness/sleep/soreness/stress, per the explicit
  ask) — doesn't cover volume or consistency trending. A plausible Phase 3
  extension, not built now.
- **Fixed 6-week window**, not user-configurable.
- **A "recent" week's numbers can still shift** until it's fully past
  (upsert-on-view, see Schema) — there's no explicit "this week is now
  final" lock, so a trend computed against a still-in-progress prior week
  (unusual, but possible right at a week boundary) uses whatever that
  week's numbers are as of the last time it was viewed, not a guaranteed-
  final value.

## Testing

Following `engine.test.ts`'s existing style:

- **`calculateReadinessTrend`** (new, pure-function unit tests): direction
  classification at and just inside/outside each metric's threshold band;
  the ≥3-of-6-weeks emit-guard suppressing a metric with insufficient data
  (and that this never defaults to `'flat'`); independence across metrics
  (one qualifying while another doesn't); confirms **no new field added to
  `generateWeeklyReview`'s own params/return** — a structural regression
  guard that the two methods stayed separate.
- **Privacy regression test**: extend the existing "never includes
  readiness/sleep/soreness/stress/pain/per-exercise data" test in
  `engine.test.ts` with a persist-then-reload round trip (write a
  `WeeklyReviewResult` to a fake/mock row shape, read `shareableSummary`
  back out, assert the same leak-check regex still holds) — same maximally-
  leaky seed pattern (unique exercise name, explicit pain notes) already
  used there.
- **Component tests**: `CoachingHistoryScreen.test.tsx` (new) — renders a
  list of mocked persisted summaries, tap → `CoachingSummaryDetail` with
  the right `workoutLogId`, empty state with none. `CoachingSummaryDetail.test.tsx`
  (new) — renders a given persisted `PostWorkoutSummaryResult` correctly
  (new PRs, best set, improved/declined — same assertions
  `WorkoutSummaryScreen.test.tsx` already makes for the live version).
  `WeeklyReviewScreen.test.tsx` (extended) — the trend card renders each
  direction correctly from mocked engine output, and is absent for a
  metric with no qualifying data.
- **No dedicated test file for the new query-layer functions themselves**
  (persistence reads/writes) — matches the existing precedent that
  `whoop.ts`/`oura.ts`/`integrations.ts` have no test files of their own;
  coverage comes through the screens that use them, same as those.

## Deferred (not in either phase, not forgotten)

Backfilling summaries for pre-existing workouts · editing/regenerating a
persisted summary · a standalone delete-summary action · volume/consistency
trending · a user-configurable trend window · unifying weekly reviews into
`CoachingHistoryScreen`'s list.

## Environment variables

None. No new edge function, no new secret — both phases are pure
client-computed-engine-output persisted via normal RLS writes, same as
every other coaching-engine persistence in this codebase
(`workout_adaptations`, `set_recommendations`, `training_patterns`).
