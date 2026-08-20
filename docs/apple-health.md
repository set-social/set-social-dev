# Apple Health / Health Connect Integration — Plan

**Status: plan only. Nothing in this doc is built.** Following the same
discipline as `docs/ai-coaching.md` and `docs/social.md`: one phase planned,
reviewed, and explicitly approved before any code is written, then shipped
before the next phase is even detailed. Phase 2 in this doc is a rough
sketch, not a committed design — it gets its own detailed pass once Phase 1
has actually shipped and whatever it teaches us is folded in.

## Why this doc exists — the premise gap

The request framed this as "follow the same phased approach as Whoop/Oura."
A repo inspection found that's true for the *product* shape (connect a
wearable, feed readiness) but not the *architecture* — and one specific
assumption in the request doesn't hold:

- **`readiness_checkins.resting_heart_rate` / `.hrv_ms` /
  `.wearable_recovery_score`, reserved in `0012_coaching_readiness.sql` for
  "a future wearable-sync milestone," were never actually used.** When
  Whoop and Oura shipped, they didn't write to these columns — they got
  their own dedicated tables (`whoop_metrics`, `oura_metrics`) instead, and
  the coaching engine reads those directly, not `readiness_checkins`. The
  reserved columns are dead: grepped every reference to all three outside
  migrations and `database.ts`'s type defs — zero hits. This plan follows
  the pattern that actually shipped (a dedicated table + a slot in the
  engine's wearable input), not the unused reservation — see "Where this
  data lands" below for the explicit reasoning.
- **Whoop/Oura is an OAuth + server-sync architecture. Apple Health and
  Health Connect are neither.** There's no third-party API, no client
  secret to protect, no access/refresh token, nothing for a server to
  pull. The data already lives on the user's device; the only role a
  server plays is *storage* for what the device already read. Forcing this
  into `integration_connections` (a table whose columns are
  `client_id, client_secret, access_token, refresh_token, token_expires_at`)
  would mean lying about what "connected" means with a row full of nulls.
  See "How this differs from Whoop/Oura" below — this is the load-bearing
  difference the whole plan is organized around.

## How this differs from Whoop/Oura, architecturally

| | Whoop / Oura | Apple Health / Health Connect |
|---|---|---|
| Auth | OAuth 2.0, server-side token exchange (`{provider}-oauth-start`/`-callback` edge functions) | None — a native permission sheet, requested and answered entirely on-device |
| Who fetches the data | A Supabase edge function (`{provider}-sync`), service-role, calling the provider's REST API | The app itself, via a native module (HealthKit / Health Connect SDK) — no third party to call |
| Who writes the metrics row | The edge function, service-role client (RLS is select-only for users on `whoop_metrics`/`oura_metrics`) | The app itself, as the signed-in user, via normal RLS (`auth.uid() = user_id`) — there's no secret being protected, so there's no reason to route this through a server at all |
| Trigger | Manual sync button + screen-focus refetch, calling the edge function | Reading the native SDK directly, on a schedule/foreground trigger — no edge function in the loop for Phase 1 |
| "Disconnect" | Deletes the token row — genuinely revokes future syncs | Can only mean "the app stops reading locally." The app **cannot** revoke a HealthKit/Health Connect grant itself — only the user can, in OS Settings. Copy must say this plainly, not imply a revocation the app can't perform. |
| Callback / redirect | `soset://{provider}-callback` deep link after the browser round-trip | None — the whole flow is synchronous, in-process, no browser involved |

Net effect: **no new edge function for Phase 1.** The client reads via a
native module, then writes straight to Supabase with its own session — the
exact same trust boundary every other user-authored row in this app
already uses (e.g. `body_metrics`, `food_log_entries`). This is a real
simplification versus Whoop/Oura, not a corner cut.

## Where this data lands

**New table, not the reserved `readiness_checkins` columns.** Following
the pattern Whoop/Oura actually established (see "Why this doc exists"
above):

- **`device_health_metrics`** (new) — one row per `(user_id, metric_date,
  source)`. Columns: `resting_heart_rate smallint`, `hrv_ms smallint`,
  `hrv_method` (`'sdnn' | 'rmssd'` — see "HRV isn't the same number on both
  platforms" below, this field is why), `sleep_duration_minutes smallint`,
  `step_count integer`, `source` (`'apple_health' | 'health_connect'`),
  `synced_at`. All metric columns nullable — a given sync may only have
  some of the four Phase 1 fields available. RLS: standard
  `auth.uid() = user_id`, full CRUD (unlike Whoop/Oura's select-only —
  there's no service-role writer here, the user's own client is the only
  writer).
- **`device_health_connections`** (new, small) — tracks permission-request
  state, *not* a token: `user_id, source, requested_at, last_synced_at`.
  Existence of a row roughly means "the user has gone through the OS
  permission sheet at least once" — it is explicitly **not** a live
  "currently granted" flag, because neither platform reliably tells the app
  that (see the HealthKit opacity limitation below). `IntegrationsScreen`
  reads this the same way it reads `integration_connections` today, but
  the presence of a row means something weaker than it does for Whoop/Oura,
  and the UI copy needs to reflect that.
- **`integration_provider` enum gains two values** (`alter type ... add
  value`, same mechanism `0035_spotify_provider.sql`/`0065_oura_provider.sql`
  already used to add `'spotify'`/`'oura'`): `'apple_health'`,
  `'health_connect'`. This keeps `IntegrationsScreen`'s existing
  `IntegrationDef[]`/`IntegrationProvider` pattern intact for the two new
  rows in the list, even though the *connection* table backing them is
  different from Whoop/Oura's.
- **`WearableReadinessInput`** (`src/services/coaching/types.ts:108-144`)
  widens its `source` union from `'whoop' | 'oura'` to include
  `'apple_health' | 'health_connect'`. `recoveryScore` is currently
  **non-nullable** on this type — see "No recovery score" below, this is
  the one real code-shape change Phase 1 requires in the engine's types,
  not just its inputs.

## HRV isn't the same number on both platforms

Apple HealthKit reports HRV as **SDNN** (`HKQuantityTypeIdentifier
.heartRateVariabilitySDNN`). Android Health Connect reports it as
**RMSSD** (`HeartRateVariabilityRmssdRecord`). These are two different
statistical measures of the same underlying signal and are **not**
directly comparable numbers — a 45ms SDNN reading and a 45ms RMSSD reading
don't mean the same thing physiologically. Whoop and Oura each report one
consistent proprietary number per platform, so this problem never came up
before. `device_health_metrics.hrv_method` exists specifically so the
engine and any UI displaying this number can label it correctly (e.g. "HRV
(SDNN): 45ms") and so a future cross-platform trend chart doesn't silently
plot two incompatible metrics on one line. **Decision needed:** Phase 1
should show this number labeled and separate, never averaged or compared
against a Whoop/Oura HRV reading — flagging this for explicit sign-off
since it constrains what the readiness engine can safely do with it (see
next section).

## No recovery score — this needs a decision, not a default

Whoop and Oura each compute a proprietary 0-100 recovery score from
signals the app never sees directly — `evaluateReadiness`'s wearable
deduction (`engine.ts:341-380`) is built entirely around that score
(recovery < 33 → −30, < 66 → −15, ≥ 90 → +5). **HealthKit and Health
Connect expose no recovery score at all** — just raw resting heart rate,
HRV, sleep duration, and step count. Two real options, not a foregone
conclusion:

1. **(Recommended for Phase 1)** Apple Health / Health Connect data is
   **informational only** — shown to the athlete (and available to Arnold)
   as raw numbers, but does **not** feed the readiness deduction. No
   synthetic scoring algorithm is built. Lowest risk, ships fastest,
   avoids inventing a recovery heuristic that competes with Whoop/Oura's
   real ones under the same UI.
2. **(Explicitly deferred)** `LocalCoachingEngine` gains a synthetic
   recovery calculation from raw HRV/RHR/sleep trend deviation (e.g.
   HRV meaningfully below the athlete's own rolling baseline). This is a
   real, non-trivial piece of scoring logic on par with a new engine
   method, not a Phase 1 add-on — it needs its own inspect → plan →
   implement pass, per this project's own stated discipline for
   nontrivial engine work.

This plan assumes **option 1** for Phase 1 pending explicit approval —
raw metrics display + Arnold context only, zero effect on the computed
readiness score or band. If that's wrong, say so before Phase 1 starts;
it changes the engine-types work above (whether `recoveryScore` can stay
non-nullable) and the `evaluateReadiness` test matrix.

## Precedence when multiple sources report the same day

`coaching.ts:241-250` already has a two-way rule for Whoop+Oura: prefer
whichever has the more recent date, tie-break to Whoop. A third and fourth
source need this addressed explicitly, not silently generalized:

**Recommended rule:** if the athlete has Whoop or Oura connected, prefer
that source for the readiness deduction — it carries a real computed
recovery score; Apple Health/Health Connect (under option 1 above) never
would. Apple Health/Health Connect data still displays as raw
supplementary detail regardless (e.g. "Resting HR: 58 bpm" alongside a
Whoop-driven readiness band), it just never overrides a proprietary
recovery score in the deduction itself. If the athlete has **only**
Apple Health/Health Connect connected, the wearable deduction path is
simply skipped (same as today, no wearable connected) and Phase 1's data
shows as informational context only. This makes Whoop/Oura genuinely
**not redundant** even for a user who also has an Apple Watch — the
proprietary recovery score remains the only thing that actually moves the
readiness number.

## Permission UX — this is where the two platforms diverge most

**iOS (HealthKit) is opaque by design.** Apple deliberately does not tell
an app which specific data types a user granted or denied — the
`requestAuthorization` completion only confirms the *request* completed,
never what was actually approved, to stop apps from inferring sensitive
inferences from selective denial. Practical effect: **the app cannot
render "Sleep ✅ / HRV ❌" the way it can for a real OAuth grant.** The
only honest signal is "did a read call actually return data" — and even
that's ambiguous (no data could mean "denied" or "no data exists yet").
`IntegrationsScreen`'s connect flow for `apple_health` should say something
like "Requested — check back after your first sync" rather than a firm
"Connected," and if reads keep coming back empty, prompt the athlete to
check **Settings → Health → Data Access & Devices → SetSocial** rather
than showing a "Connect" button that does nothing on a second tap (iOS
only shows the system permission sheet once per install per data type —
there is no in-app re-prompt after an initial denial).

**Android (Health Connect) behaves like a normal runtime permission** —
the app *does* get a real per-type grant/deny result, and can re-prompt.
Health Connect must also be installed (pre-installed on Android 14+;
optional via Play Store on 13 and below) — a real device-availability gap
iOS doesn't have, since HealthKit ships with the OS. `IntegrationsScreen`
should detect Health Connect's absence and route to installing it rather
than silently failing the permission request.

**Both platforms**: disconnect can only mean "stop reading locally" (see
the architecture table above) — `onDisconnect`'s existing confirm-dialog
copy ("This will remove your connection...") needs different wording for
these two rows, since nothing is actually being revoked server-side.

## Free-for-everyone policy

`IntegrationsScreen.tsx`'s `requiresPremium()` (line 47) already hardcodes
`false` for every provider — "No integration currently requires SetSocial
Pro." **This plan follows the same policy explicitly**: Apple Health and
Health Connect are free for every athlete, same as Whoop/Oura/Spotify.
Stated here so it's a confirmed decision, not an assumption inherited
silently.

## Data Safety / privacy

This adds a new disclosed data category — **the Data Safety inventory
already produced for the Android Readiness Audit needs one more row**
("Health & fitness — Health Connect resting HR/HRV/sleep/steps") once this
ships; iOS's own `PrivacyInfo.xcprivacy` and App Store health-data
disclosure need the equivalent update. Both are Play Console / App Store
submission steps, not code — flagged here so they aren't discovered late,
not addressed in this doc.

`device_health_metrics`/`device_health_connections` get the same
`auth.uid() = user_id` RLS every other private table in this app already
uses — no new sharing surface, no third party ever receives this data
except Arnold's own system prompt (same treatment `whoop_metrics`/
`oura_metrics` already get in `chat-coach`).

## Library choice

Researched against this project's actual constraints — RN 0.86,
`newArchEnabled=true`, and (as of RN 0.82) **no legacy bridge exists to
fall back to**, so New Architecture support isn't a nice-to-have here, it's
required for a library to work at all:

- **iOS: `@kingstinct/react-native-healthkit`**, not the older
  `agencyenterprise/react-native-health`. It's built on Nitro Modules
  specifically for New Architecture/TurboModules, actively maintained.
  One known rough edge: `subscribeToChanges` (background observer queries)
  doesn't work correctly under New Architecture as of this research — not
  a blocker for Phase 1 (foreground/manual sync only, see "Deferred"
  below), but rules out background delivery until that's resolved
  upstream or worked around.
- **Android: `react-native-health-connect`** (matinzd) — explicit New
  Architecture support (`fabricEnabled` via `DefaultReactActivityDelegate`,
  same pattern this app's own `MainActivity.kt` already uses), requires
  RN ≥0.71 (this app is 0.86). No red flags found.
- **Native permission entries required:**
  - iOS `Info.plist`: `NSHealthShareUsageDescription` (read-only for
    Phase 1 — no `NSHealthUpdateUsageDescription` needed since nothing is
    written back to HealthKit). Also requires enabling the HealthKit
    capability/entitlement in the Xcode project (`ios/GymBee.entitlements`
    or equivalent) — this org already has a paid Apple Developer account
    (the app already ships to TestFlight), so no new account-level
    blocker there.
  - Android `AndroidManifest.xml`: `android.permission.health.READ_HEART_RATE`,
    `android.permission.health.READ_HEART_RATE_VARIABILITY`,
    `android.permission.health.READ_SLEEP`,
    `android.permission.health.READ_STEPS`. As of a 2026 Health Connect
    policy change, the standalone Google Form for declaring sensitive
    health-permission access is retired (Sept 2026) — this now goes
    through a Play Console declaration instead, the same console surface
    already tracked as a submission dependency in the Android Readiness
    Audit. One more thing to fold into that existing checklist, not a new
    one.

**Confirmed clean slate**: no existing HealthKit/watchOS code anywhere in
`ios/` (the only "watchos" string hits are generic CocoaPods Xcode
build-setting boilerplate, unrelated to any real feature), no
`android.permission.health.*` entries in the manifest, and neither
`react-native-health` nor `react-native-health-connect` is in
`package.json` today.

## Roadmap

1. **Phase 1 (this doc, pending approval)** — iOS / HealthKit only. Read
   resting heart rate, HRV (SDNN), sleep duration, step count. On-device
   read → client writes `device_health_metrics` directly (no edge
   function). `IntegrationsScreen` connect/disconnect row, HealthKit's
   opacity handled honestly in the UI. Informational display + Arnold
   context only — **no** effect on the computed readiness score (see "No
   recovery score" above). Foreground/manual sync only, no background
   delivery.
2. **Phase 2 (sketch only — gets its own detailed doc after Phase 1
   ships)** — Android / Health Connect, mirroring Phase 1's shape with the
   platform differences called out above (real grant/deny signal, Health
   Connect install-gate, RMSSD instead of SDNN). Whether to reuse
   `device_health_metrics`/`_connections` as-is or whether Phase 1
   surfaces a reason to adjust the schema is an explicit open question to
   revisit once Phase 1's real usage exists, not decided now.

Each phase ships and is used before the next is designed in detail — same
discipline `docs/ai-coaching.md`'s 12 phases and `docs/social.md`'s 6
phases already followed.

## Known limitations (Phase 1)

- **No live "granted" status on iOS** — see "Permission UX" above.
  "Connected" in this UI means "requested," not "confirmed granted."
- **No recovery-score contribution** — raw numbers only, doesn't move the
  readiness band. See "No recovery score" above for the reasoning and the
  deferred alternative.
- **No background sync** — data refreshes on app foreground / manual
  trigger only, same posture as Whoop/Oura's own manual-sync-plus-refetch
  pattern, not a regression versus them. True background delivery is
  blocked on the upstream `subscribeToChanges` New Architecture issue
  noted above, and is its own scoped follow-up regardless.
- **HRV not comparable across sources** — SDNN (Apple) vs RMSSD (Health
  Connect) vs Whoop/Oura's own proprietary numbers are three different
  things wearing the same "HRV" label; `hrv_method` exists so nothing
  averages them together by accident.
- **No write-back** — Phase 1 never writes workout/exercise data *into*
  HealthKit. A real, deliberately out-of-scope feature (Apple Health is
  widely used as a data *hub* other apps read from) — worth its own future
  pass, not bundled in here.
- **Android is not built this phase** — see Roadmap. A user on Android
  gets nothing from this integration until Phase 2 ships.

## Deferred (not in Phase 1, not forgotten)

Sleep-stage breakdown (REM/deep/light — both platforms expose this, more
mapping effort deferred) · SpO2, respiratory rate, skin temperature,
active energy, VO2 max · workout-session ingestion from HealthKit/Health
Connect · background/observer-driven sync · write-back to either platform
· synthetic recovery scoring (see "No recovery score" above) · a
cross-platform HRV normalization/comparison feature · Android/Health
Connect itself (Phase 2).

## Testing (planned scope for Phase 1, once approved)

Following `docs/ai-coaching.md`'s existing convention — engine-level unit
tests for the widened `WearableReadinessInput` union and the Whoop/Oura-
over-Apple-Health precedence rule (`evaluateReadiness`'s existing test
file, extended, plus `coaching.ts`'s precedence logic tests), a query-layer
test for the new `device_health_metrics` write path, and a component test
for `IntegrationsScreen`'s new row covering the "requested, not confirmed"
copy state and the Settings-redirect path when reads keep coming back
empty.

## Environment variables / secrets

None. No new edge function, no client secret, no third-party API key —
the whole point of this architecture (see "How this differs from
Whoop/Oura" above).
