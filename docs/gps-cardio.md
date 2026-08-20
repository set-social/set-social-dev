# GPS-Tracked Cardio

**Status: Phase 1 shipped, with background tracking pulled forward from
Phase 2 at explicit request.** The plan below was reviewed and approved as
written; one deliberate scope change happened during implementation and is
called out here rather than silently folded in — see "What actually
shipped" immediately below. Phase 3 (route posts/sharing) remains
unbuilt and unplanned in detail, exactly as originally scoped.

## What actually shipped

The approved Phase 1 plan below explicitly scoped out background tracking
("Known limitation: no background tracking," deferred to Phase 2) because
it needs a background-capable permission model and native platform work
this pass didn't originally include. The build request that followed
explicitly asked for continuous tracking "even if the user moves away from
the app but doesn't kill it" — i.e. exactly Phase 2's scope, requested
before Phase 1 shipped rather than after, per the roadmap's own "next
phase informed by real usage of the previous one" reasoning. Rather than
build a Phase 1 known to not meet that explicit requirement, background
tracking was pulled forward and built now. Concretely, beyond the Phase 1
plan below:

- **iOS**: requests `NSLocationAlwaysAndWhenInUseUsageDescription` (new
  Info.plist key, added alongside the existing When-In-Use string) and
  `UIBackgroundModes` gained `location`. `routeTracking.ts` calls
  `Geolocation.setRNConfiguration({ authorizationLevel: 'always' })` only
  for a live-tracked session — the "At My Gym" check-in
  (`currentLocation.ts`) is untouched and still only ever requests
  When-In-Use; `stopRouteTracking` resets the shared native module's
  configuration back afterward specifically so this doesn't leak into that
  unrelated flow.
- **Android**: requests `ACCESS_BACKGROUND_LOCATION` (a second, separate
  runtime request after foreground access, per the OS's own two-step
  requirement) and runs a minimal foreground service
  (`CardioTrackingService.kt`, started/stopped exactly bracketing a live
  session) so the process isn't throttled while backgrounded. On Android
  11+ (API 30+), the OS won't show a runtime dialog for
  `ACCESS_BACKGROUND_LOCATION` at all — `LiveCardioTrackingScreen` degrades
  to foreground-only tracking with the "gap" indicator in that case,
  exactly the honest-degradation design the original plan called for, just
  reachable on more devices than originally scoped.
- Both platforms: this is a real product/store-review surface, not just
  code — Always-location usage on iOS and background location on Android
  both require clear in-review justification (App Store Review Guidelines
  and Google Play's "prominent disclosure" policy respectively). Nothing
  here builds that review copy; it needs to exist before either store
  submission ships this feature.
- `android/app/build.gradle` (`versionCode`/`versionName`) and
  `ios/GymBee.xcodeproj/project.pbxproj` (`MARKETING_VERSION`/
  `CURRENT_PROJECT_VERSION`, app target only) were bumped, since this
  ships to both platforms.
- `react-native-maps` was added (the library this doc recommended) —
  **Android needs a real Google Maps API key** in
  `AndroidManifest.xml`'s `com.google.android.geo.API_KEY` meta-data
  entry before an Android build will render map tiles; the checked-in
  value is a placeholder. iOS needs no key (Apple MapKit).
- `docs/mockups/gps-cardio.html` (reviewed and approved) is the visual
  reference the two new screens were built against.

## Original Phase 1 plan (as approved)

Everything below is the plan as written and approved. It has not been
rewritten to match the shipped background-tracking change above — that
change is documented separately, above, for a clear "what was decided vs.
what changed mid-build" trail. Phase 1's data model, entry point, screens,
and testing approach below are otherwise exactly what was built.

## Why this doc exists — the premise gap

The request assumed "replacing the current manual-entry-only cardio
logging." A repo inspection found that's the wrong frame in one important
way, and confirms the right frame in two others:

- **This must be additive, not a replacement.** `LogCardioScreen.tsx`
  (`src/screens/log/LogCardioScreen.tsx`) is how someone logs a treadmill
  session, an outdoor run their watch already tracked, or "20 min on the
  hotel elliptical" — none of which have or need a live GPS trace. Making
  GPS tracking the only path to log cardio would break every one of those.
  This plan adds a second entry point (live tracking) alongside the
  existing manual form, never in place of it.
- **There is no reusable location-tracking infrastructure to build on.**
  `src/services/location/currentLocation.ts` is a one-shot
  `getCurrentPosition()` call for the "At My Gym" check-in
  (`gym_checkins`) — by its own doc comment, "never a subscription, never
  background." It's a precedent for how this app asks for location
  permission and handles the two failure modes (denied / unavailable), not
  a piece of infrastructure a continuous `watchPosition` session can reuse.
  Live route tracking is a new subsystem.
- **`@react-native-community/geolocation` (the only location library
  installed — confirmed via `package.json`) is foreground-only.** It has
  no background-execution story on either platform: no iOS background
  mode integration, no Android foreground-service wrapper. It is fine for
  Phase 1's foreground-only tracking (see "Known limitation: no background
  tracking" below) but is **not** sufficient on its own for a run that
  needs to keep recording while the phone is locked or the user switches
  apps — that needs a dedicated background-geolocation library, deferred
  to a later phase (see "Library choice" below).

## Library choices

### Location: keep `@react-native-community/geolocation` for Phase 1, defer background tracking

Phase 1 only tracks while the app is foregrounded and the screen is
active (see "Known limitation: no background tracking"). For that scope,
`watchPosition({ enableHighAccuracy: true, distanceFilter: ..., interval:
... })` on the already-installed library is sufficient — no new native
dependency needed for Phase 1's location layer itself.

A real "lock your phone and go" running-app experience needs continuous
tracking through backgrounding, which requires a dedicated library (most
likely `react-native-background-geolocation` (Transistor Software) or
`@mauron85/react-native-background-geolocation`'s maintained forks — both
wrap native iOS significant-location-change / CLLocationManager background
modes and an Android foreground service). That evaluation and its App
Store/Play Store review implications (background location usage requires
written justification in both stores' review process) is scoped to a
later phase, not Phase 1 — see "Known limitation: no background tracking."

### Maps: no map-rendering library is installed — recommend `react-native-maps`

Confirmed via `package.json`: no `react-native-maps`, `@rnmapbox/maps`, or
similar. `react-native-maps` is the recommended addition — it's the
de facto standard for this use case (native MapKit on iOS / Google Maps on
Android, `Polyline` component maps directly onto a route's point array,
large community, no extra account/API-key setup required for the free
tier of either platform's base map). `@rnmapbox/maps` is a reasonable
alternative if a more custom map style is wanted later, but needs a
Mapbox account/token and is more setup for no functional gain at this
stage. This is a new native dependency — not installed in this pass, per
the instruction to plan only.

## Data model

### Decision: two new columns on `cardio_log_entries` + a new child table for route points, not a single JSON blob

`cardio_log_entries` (`0040`-era migration, confirmed via
`src/types/database.ts`) already captures `duration_minutes`,
`distance_km`, `incline_pct`, `speed_kmh`, `effort`,
`estimated_calories` — a route is additive metadata on top of an existing
row, not a different kind of row. Reasoning on the three options considered:

| Option | Verdict |
|---|---|
| Store the whole route as one `jsonb`/geography column on `cardio_log_entries` | Rejected as the *only* storage. Cheap to write, but per-point queries (e.g. "show pace at kilometer 3") mean deserializing the entire blob client-side every time, and it doesn't compose with Postgres the way a real table does. |
| One child table, one row per GPS point | **Recommended.** `cardio_route_points` — `(cardio_log_entry_id, seq, latitude, longitude, recorded_at, elevation_meters nullable)`. A 45-minute run at one point every ~5-8 seconds (see "Battery/accuracy tradeoffs" below) is roughly 350-550 rows — trivial at this app's scale (same "fine at expected personal-fitness-app data scale" judgment call `docs/ai-coaching.md`'s progress-timeline section already made for a similar all-rows-no-pagination choice). Ordinary indexed row access, easy to `select ... order by seq` for the post-run polyline, easy to aggregate (`avg`, split boundaries) in SQL later if ever needed. |
| PostGIS `geography(LineString)` column | Rejected for this pass. Correct GIS modeling, but this Supabase project has no evidence of the PostGIS extension being enabled anywhere in the existing 78 migrations, and none of this app's actual needs (draw a polyline, compute pace/splits) require true geospatial query operators (`ST_DWithin`, `ST_Length`, etc.) — those would only pay off if the product grows into cross-user route features (e.g. "runs near me"), which isn't in scope here. Revisit if that ever becomes a real requirement. |

**New columns on `cardio_log_entries`** (nullable — every existing manual
entry keeps working with these `null`, exactly like `readiness_checkins`'
wearable columns being `null` until Whoop/Oura shipped):
- `has_route boolean not null default false` — cheap flag so list/history
  queries can tell "this session has a route" without a join, mirroring
  how `workout_logs.variant_type` was added as a flag-like column upfront.
- `avg_pace_sec_per_km integer null`
- `best_pace_sec_per_km integer null` (fastest single split — see splits
  below)
- `elevation_gain_meters integer null` (Phase 1: omitted — see "Known
  limitation: no elevation" below; column reserved but always `null` until
  a later phase populates it from `recorded elevation` if available)

**New table, `cardio_route_points`:**
```
id uuid primary key default gen_random_uuid()
cardio_log_entry_id uuid not null references cardio_log_entries(id) on delete cascade
seq integer not null              -- 0-based order within the route
latitude double precision not null
longitude double precision not null
recorded_at timestamptz not null  -- device clock at capture, for pace math
elevation_meters double precision null
unique (cardio_log_entry_id, seq)
```
RLS: `auth.uid() = (select user_id from cardio_log_entries where id =
cardio_log_entry_id)` for `select`/`insert`/`delete` — same
owner-only-via-parent pattern `workout_log_sets` already uses relative to
`workout_logs`.

**Splits** are not stored as their own rows — they're a derived view over
`cardio_route_points`, computed client-side (same "no memory concept
worth storing" judgment `docs/ai-coaching.md` made for PR predictions,
which are recomputed fresh from `workout_log_sets` every time rather than
persisted). A pure function takes the ordered point array and emits one
split per completed kilometer/mile (unit-preference aware, same
`profiles.units` split every other distance display in this app already
reads), each with its own duration and pace. This keeps `cardio_route_points`
as the single source of truth and avoids a second table that could drift
from it.

## Screens

### Entry point: a new choice on `LogCardioScreen`, not a separate flow

`LogCardioScreen` currently jumps straight into the manual form. This
plan adds a top-of-screen choice — **"Track Live"** vs. **"Enter
Manually"** — presented once, before the activity list, defaulting to
whichever the user picked last (a simple local preference, not
`profiles`-backed). Only `run`/`walk`/`bike` activities (the ones
`showsDistance()` already flags as distance-relevant, per the
`LogCardioScreen.tsx` inspection) offer "Track Live"; treadmill/elliptical/
rowing/stairmaster stay manual-only since GPS is meaningless indoors.
Picking "Track Live" navigates to a new `LiveCardioTrackingScreen`
instead of rendering the existing form; picking (or defaulting to) "Enter
Manually" renders `LogCardioScreen` exactly as it does today — **zero
changes to the existing form's fields, validation, or save path.**

### `LiveCardioTrackingScreen` (new)

Shown while a GPS session is active. Per the mockup
(`docs/mockups/gps-cardio.html`):

- A map area showing the live route as it's drawn (a growing `Polyline`
  centered/following the current position).
- Live stats: elapsed duration, current distance, current pace
  (min/km or min/mi per `profiles.units`), all recomputed on every
  accepted GPS fix.
- Pause/Resume and Finish controls. Pausing stops recording points (so a
  red-light stop doesn't pollute the pace calculation) without discarding
  what's captured so far; Finish navigates to the post-run summary screen.
- A location-permission-denied state (see "Permissions UX" below) that
  routes back to manual entry instead of showing a broken/empty map.

**Store**: a new `activeCardioStore` (Zustand, `src/store/`), modeled
directly on `activeWorkoutStore.ts`'s conventions rather than invented
fresh:
- Same `persist` + `AsyncStorage` + `hasHydrated` pattern, so a
  kill-and-relaunch mid-run can detect and offer to resume (or discard) an
  in-progress session, the same problem `activeWorkoutStore` already
  solves for strength sessions.
- Timestamp-based elapsed time (a `startedAt`/`pausedIntervalsMs` shape,
  not a decrementing counter) — same reasoning as `activeWorkoutStore`'s
  `restEndsAt`: recomputing from wall-clock timestamps is immune to JS
  timers being suspended while backgrounded, which matters even for
  Phase 1's foreground-only tracking (switching to another app briefly,
  or the OS suspending JS on a locked-but-still-recording screen, must
  not desync the displayed duration once foregrounded again).
- Route points held as an in-memory array during the session, persisted
  incrementally to `AsyncStorage` (not just at Finish) so an app kill
  mid-run loses at most the last few unsaved points, not the whole route.
- `startSession`, `addPoint`, `pauseSession`, `resumeSession`,
  `finishSession`, `discardSession`, `reset` — mirroring
  `activeWorkoutStore`'s action-per-transition shape.

**Backgrounding behavior (Phase 1, explicit scope)**: if the app is
backgrounded mid-session, tracking **stops** — `watchPosition` callbacks
on `@react-native-community/geolocation` do not fire while suspended, per
"Library choices" above. On foreground, the store resumes recording from
wherever GPS re-acquires, and the screen shows a small "route paused —
{N} sec of tracking gap" indicator rather than silently pretending the
gap didn't happen. This is a real, named limitation — see "Known
limitation: no background tracking."

### `CardioRunSummaryScreen` (new)

Shown after Finish. Per the mockup:

- Route map (static, full route visible — same `Polyline`, no longer
  live-updating).
- Stats card: total distance, duration, avg pace, elevation (Phase 1:
  omitted per "Known limitation: no elevation").
- Splits table: one row per km/mile with that split's pace, fastest
  split visually called out.
- **Save** button — flows into the *same* `useSaveCardioLog` mutation
  `LogCardioScreen` already uses (`src/services/api/queries/cardioLogs.ts`),
  extended with an optional `route` param: when present, the mutation
  additionally bulk-inserts the `cardio_route_points` rows and sets
  `has_route`/`avg_pace_sec_per_km`/`best_pace_sec_per_km` on the
  `cardio_log_entries` insert. `activityKey`/`effort`/calorie-estimate
  logic is unchanged — a GPS run still goes through
  `estimateCardioCalories` exactly as a manually-entered run does, just
  with `distanceKm`/`durationMinutes` prefilled from the tracked route
  instead of typed in. This is the same "one save mutation, richer input"
  shape `docs/ai-coaching.md`'s `generatePostWorkoutSummary` used relative
  to the pre-existing save flow — the completion path is not duplicated.
- A **Share** button — see "Sharing" below.
- Discard flow (back button while unsaved) confirms via `Alert.alert`,
  matching this codebase's existing destructive-confirm pattern (block
  user, delete workout, etc.).

## Sharing

`ShareWorkoutScreen.tsx` and `docs/social.md`'s `posts` system were
inspected. A completed route is a natural fit for the **existing** posts
model, not a new post type built this pass:

- `docs/social.md`'s Phase 3 already established `post_type` as an
  extensible enum (`alter type ... add value` is called out there as "a
  normal, low-risk way to extend it later"), and Phase 6 reframed the
  whole Community tab around photo-style posts specifically.
- A route card (map snapshot + pace/distance headline) is visually the
  same shape as a progress-photo post — one hero image, a caption — if
  the map is rendered to a static image at save time (`react-native-maps`
  supports snapshotting a `MapView` to a PNG). That reuses
  `useCreatePhotoPost`, `PostThumbnail`, `PostDetailScreen`, and the
  entire Community grid **unchanged**, rather than building a parallel
  "route post" rendering path through every one of those screens.
- **Decision: sharing a completed route as a Community post is Phase 3 of
  this plan, not Phase 1 or 2** — it depends on the map-snapshot
  mechanism working first, and per this project's own phased-approval
  discipline, a sharing surface shouldn't be designed in detail until the
  tracking/save core it depends on has actually shipped and been used.
  The Phase 1/2 "Share" button on `CardioRunSummaryScreen` instead reuses
  the **existing** `ShareWorkoutScreen`/`useCreateWorkoutShare` DM-share
  flow (share a completed run to a specific friend via direct message,
  same as any other workout share today) — no new capability, just
  pointing an existing mechanism at a new payload shape.

## Permissions UX

Per `currentLocation.ts`'s existing pattern and `Info.plist`/
`AndroidManifest.xml`'s existing entries:

- **iOS**: Phase 1 (foreground-only tracking) needs no new Info.plist key
  beyond the existing `NSLocationWhenInUseUsageDescription` — but its
  *copy* needs updating, since it currently reads "...only when you tap
  'Check In'..." which would now be false. `NSLocationAlwaysAndWhenInUseUsageDescription`
  (needed for background tracking) is explicitly **not** added in Phase 1
  — see "Known limitation: no background tracking."
- **Android**: `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION` are already
  present and sufficient for Phase 1 foreground tracking.
  `ACCESS_BACKGROUND_LOCATION` (a separate runtime permission on API 29+,
  requestable only after foreground access is already granted, and itself
  requiring a Play Console "prominent disclosure" review for apps that
  request it) is **not** added in Phase 1, same reasoning as iOS.
- **Request timing**: the permission prompt fires the first time the user
  taps "Track Live," not on app launch or on `LogCardioScreen` mount —
  same "ask at the moment of use" precedent `currentLocation.ts` already
  established for check-ins.
- **Denial handling — this is the hard requirement from the request**: if
  location permission is denied (or later revoked in OS Settings),
  `LiveCardioTrackingScreen` never renders a broken map. Tapping "Track
  Live" with permission denied shows an inline explanation ("SetSocial
  needs location access to track your route live — you can still log this
  session manually.") with two actions: **"Enter Manually"** (routes
  straight into the existing, fully-unaffected `LogCardioScreen` form) and
  **"Open Settings"** (`Linking.openSettings()`, same escape hatch pattern
  already used for the OAuth/mailto package-visibility handling in
  `AndroidManifest.xml`'s `<queries>` block). Manual entry is never gated
  behind a location grant, at any point in this flow.

## Battery/accuracy tradeoffs

For a 30-90 minute run/ride:
- `enableHighAccuracy: true` (GPS, not network/cell-tower positioning) —
  needed for a route worth looking at; the existing check-in use of this
  same flag is a one-shot read, so this is new *sustained* battery cost,
  not a precedent that already proved it's cheap over a long session.
- `distanceFilter: 10` (meters) rather than a pure time interval — only
  fires a new fix when the device has actually moved ~10m, which
  naturally throttles the update rate to near-zero while stopped at a
  light or tying a shoe, without a separate "are we stationary" check.
- A time-based ceiling as a backstop (`interval`/`fastestInterval` on
  Android's underlying provider) around 5-8 seconds, so pace still
  updates at a reasonable cadence even during slow, steady movement where
  the distance filter alone would space fixes out awkwardly.
- Together this is the standard "running app" tradeoff — noticeably more
  battery draw than the app's normal foreground idle cost, but far less
  than naive `maximumAge: 0`/no-filter continuous high-accuracy polling.
  Exact numbers should be measured against real devices before Phase 1 is
  called done (see Testing), not assumed from these settings alone.

## Phases

### Phase 1 — Foreground-only live tracking, manual save (this plan's primary ask)

- `cardio_route_points` table + the four new `cardio_log_entries` columns
  (migration).
- `activeCardioStore`.
- `LiveCardioTrackingScreen` (foreground tracking only, pause/resume,
  Finish).
- `CardioRunSummaryScreen` (map, stats, splits, Save — via the extended
  `useSaveCardioLog`).
- Entry-point choice added to `LogCardioScreen` (Track Live / Enter
  Manually), existing manual form otherwise untouched.
- Permission copy updates (`Info.plist`), denial → manual-entry fallback.
- New dependency: `react-native-maps` (native install + pod/gradle work).
- No new dependency for location itself — `@react-native-community/geolocation`
  covers foreground `watchPosition`.
- Sharing: reuses the existing DM `ShareWorkoutScreen` flow only — no new
  post type.

**Superseded — background tracking shipped with Phase 1.** This limitation
as originally written (below, unedited for the historical record) assumed
Phase 2 would be a separate future pass. That changed mid-build — see
"What actually shipped" at the top of this doc. The lighter approach taken
(the already-installed `@react-native-community/geolocation`'s own
`enableBackgroundLocationUpdates`/Always-authorization support on iOS, and
a minimal keep-alive foreground service — not a third-party
background-geolocation library — on Android) covers the "moved away from
the app but didn't kill it" case without the Phase 2 evaluation below.
Original text: backgrounding the app mid-run stops point capture (see
"Backgrounding behavior" above); the route will show a visible gap for
however long the app was backgrounded. This is the single biggest gap
versus a "real" running app (Strava, Apple Fitness) and is a deliberate
Phase 1 scope cut, not an oversight — building it correctly needs a
dedicated background-geolocation library, new native permission entries on
both platforms (`NSLocationAlwaysAndWhenInUseUsageDescription` + a
`location` UIBackgroundMode on iOS; `ACCESS_BACKGROUND_LOCATION` + a
foreground service + its own notification on Android), and each store's
review scrutiny for background-location apps. That's Phase 2's entire
scope, not a Phase 1 add-on.

**Known limitation: no elevation.** `elevation_meters` is captured per
point (when the device provides it) but `elevation_gain_meters` on
`cardio_log_entries` stays `null` in Phase 1 — computing a meaningful gain
figure from noisy phone-GPS altitude readings (which drift far more than
lat/lng) needs its own smoothing pass, deferred rather than shipping a
number likely to be visibly wrong.

**Known limitation: no live turn-by-turn map interactivity.** The map
during a live session auto-follows the current position; it isn't
pan/zoomable mid-run in Phase 1 (that's a `MapView` prop flip, but adding
free gesture control mid-run raises "does it re-center automatically
after" UX questions worth designing deliberately rather than bolting on).

**Known limitation: splits are whole-unit only.** Splits land on exact
km/mi boundaries derived from cumulative GPS distance — no "custom
interval" splits (e.g. every 400m) and no auto-lap-on-pause behavior
beyond what pausing already does (stops recording, doesn't insert a split
marker).

### Phase 2 — Background tracking — shipped early, folded into Phase 1

Original scope (unedited): continuous recording through app backgrounding
/ screen lock. Needs: a background-geolocation library evaluation and
swap-in (`react-native-background-geolocation` most likely, per "Library
choices"), the additional native permission entries named above, a
persistent foreground-service notification on Android while tracking
(required by the OS, not optional), and re-testing the entire
battery/accuracy tradeoff against real sustained background use. Detailed
design deferred to its own pass once Phase 1 has shipped and real usage
data (how often do people background mid-run today, on the foreground-only
version) can inform whether the added complexity is worth it.

**What actually happened**: this was requested before Phase 1 shipped, so
the "real usage data first" premise above didn't get to play out. Built
using the lighter of the two options this doc named — native
`enableBackgroundLocationUpdates`/Always-authorization (iOS) and a
minimal keep-alive foreground service (Android), not the dedicated
background-geolocation library — see "What actually shipped" at the top
of this doc for what that trades away (still needs real-device
battery/accuracy validation against a real 30-90 minute backgrounded
session before this is store-ready, and still needs store-review
disclosure copy for both platforms).

### Phase 3 — Route posts (Community sharing)

Map-snapshot-to-image at save time, wiring `CardioRunSummaryScreen`'s
Share button to `useCreatePhotoPost` with a new `post_type` value
(`cardio_route`), a route-specific `PostThumbnail`/`PostDetailScreen`
rendering branch (map image + pace/distance headline instead of a plain
photo). Detailed design deferred — see "Sharing" above for why this
isn't bundled into Phase 1.

## Testing

Matching this codebase's existing split (pure-logic unit tests +
component tests, per `docs/ai-coaching.md`'s `engine.test.ts` /
`LogCardioScreen.test.tsx`-style precedent — note `LogCardioScreen.test.tsx`
already exists and is the pattern for the two new screens' tests below):

- **`src/utils/__tests__/routeMetrics.test.ts`** (new) — for a new pure
  module, `src/utils/routeMetrics.ts`, holding all point-array math with
  zero React/store/Supabase dependency: `computeDistanceKm(points)`
  (haversine over consecutive points), `computePaceSecPerKm(distanceKm,
  durationSeconds)`, `computeSplits(points, unitDistanceKm)` (split
  boundaries, per-split pace, handles a route shorter than one full unit
  → empty splits, not an error), and a GPS-noise guard (points implying
  an implausible instantaneous speed — e.g. a bad fix jumping 200m in one
  second — are excluded from distance/pace math rather than corrupting
  the whole session's numbers). Table-driven, same style as
  `progressTimeline.test.ts`/`trainingScheduleWalk.test.ts`.
- **`src/store/__tests__/activeCardioStore.test.ts`** (new) — session
  start/pause/resume/finish/discard transitions, that `addPoint` no-ops
  while paused, and elapsed-time recomputation from timestamps rather than
  a decrementing counter (same wall-clock-recompute assertion style
  `activeWorkoutStore` would need if it had a dedicated test file for its
  rest timer — this is this store's equivalent).
- **`src/screens/log/__tests__/LiveCardioTrackingScreen.test.tsx`** (new)
  — mocked location updates render growing distance/duration/pace,
  Pause/Resume toggles recording, permission-denied state renders the
  manual-entry fallback and does *not* render a map, Finish navigates to
  `CardioRunSummary`.
- **`src/screens/log/__tests__/CardioRunSummaryScreen.test.tsx`** (new) —
  splits table renders the mocked split data, Save calls the extended
  `useSaveCardioLog` with a `route` payload and navigates home exactly
  like `LogCardioScreen`'s existing Save does, Discard confirms via
  `Alert.alert` before clearing the session.
- **`src/screens/log/__tests__/LogCardioScreen.test.tsx`** (extended, not
  rewritten) — new assertions only for the added Track Live/Enter
  Manually choice and that non-distance activities (treadmill etc.) don't
  offer Track Live; every existing test in this file continues to pass
  unmodified, since the manual form itself doesn't change.
- **Device-level battery/accuracy validation** (manual, not automated) —
  per "Battery/accuracy tradeoffs" above, the `distanceFilter`/interval
  settings should be validated against real outdoor runs on both
  platforms before Phase 1 is considered done; this is a real-device
  check the user should run, consistent with this project's existing "no
  simulator testing" practice for anything GPS/hardware-dependent (a
  simulator's location is synthetic and won't surface real accuracy/
  battery behavior anyway).

## Environment variables

None needed for Phase 1 — `react-native-maps` uses each platform's native
map provider (Apple MapKit on iOS needs no key; Android needs a Google
Maps API key added to `AndroidManifest.xml`/`local.properties`, a
one-time native setup step at install time, not a runtime secret).

## Native permissions (Phase 1 summary)

- iOS: existing `NSLocationWhenInUseUsageDescription`, copy updated.
- Android: existing `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION`,
  unchanged.
- No background-location entries on either platform this phase (see
  Phase 2).
