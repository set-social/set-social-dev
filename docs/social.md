# Social Overhaul Architecture

This document covers the friends/social system being built on top of
SetSocial's existing (much smaller than initially assumed) community
features. It's the map for continuing past this pass.

## Why this doc exists — the premise gap

The originating request was framed as "extend the existing friend
requests, progress photos, before/after photos, reactions, comments, and
detail screens." A repo inspection at the start of this work found that
almost none of that existed:

- **Friends** was a public, instant, one-directional `follows` table
  (`follower_id`/`followee_id`) — no request/pending/accepted state.
- **No photos of any kind** — `body_metrics` is weight-only.
- **No posts, reactions, or comments table** anywhere.
- `activity_feed` (a view over `workout_logs`) was the entire "feed" —
  rendered as plain "X completed a workout" rows.
- Only `PRDetailScreen` existed among the "detail screens" the request
  assumed were already there.

The user chose to build the full originally-requested scope, phased —
this mirrors how `docs/ai-coaching.md`'s 11-phase build was run: one
phase planned, approved, and shipped at a time.

## Roadmap

1. **Phase 1 (shipped)** — Friends domain: real request/accept
   relationships, replacing `follows`.
2. **Phase 2 (shipped)** — Blocked users + filtering baked into every
   social query.
3. **Phase 3 (shipped)** — `posts` table (progress photo,
   before/after photo) with `visibility` (private/friends), a private
   Storage bucket, upload flow with a `VisibilitySelector`. Write path
   only — see the Phase 3 section below for why the read path (a feed,
   "my posts" on a profile) and the workout-completed/PR/streak/general
   post types are deliberately deferred to Phase 4.
4. **Phase 4 (shipped, later superseded — see Phase 6)** — Feed
   unification: a real unified `useFeed` (`workout_completed` +
   `progress_photo` + `before_after_photo`, newest first), a
   `PostDetailScreen`, and "Posts" sections on both profile screens.
   Reactions/comments and PR/streak-milestone feed items were
   deliberately deferred — see the Phase 4 section below for why. **The
   mixed workout+photo feed (`useFeed`/`FeedEntry`/`feed.ts`) itself was
   later deleted in Phase 6** once the product direction moved to a
   posts-only, Instagram-style Community tab — `PostDetailScreen` and
   the profile "Posts" sections are still exactly as this phase built
   them.
5. **Phase 5 (shipped, later superseded — see Phase 6)** — Home "Friends
   Activity" section (3 most recent, photo posts prioritized, "View
   All"), skeleton/empty/error states, analytics events, accessibility
   labels. See the Phase 5
   section below.

## Phase 1 — Friends domain

### Migration `supabase/migrations/0017_friend_requests.sql`

- **`friend_requests`** — `requester_id`, `addressee_id`,
  `status` (`pending` | `accepted` | `declined`), `created_at`,
  `resolved_at`. `unique (requester_id, addressee_id)` plus a no-self-request
  check. RLS: both participants can `select`; only the `requester` can
  `insert`; only the `addressee` can `update` (accept/decline — the only
  status transitions); **either** participant can `delete` (covers both
  "cancel a pending request I sent" and "unfriend" an accepted one — a
  removal is a delete, not a third status, keeping the status enum to
  exactly the two real transitions).
- **`follows` is untouched, not dropped** — it's simply no longer read or
  written by the app after this migration. Safe no-op table, matches this
  repo's non-destructive-migration convention.
- **Backfill**: a *mutual* pair of existing `follows` rows (A→B and B→A
  both present) becomes one accepted `friend_requests` row — a
  best-effort "these two already had a relationship, don't make them
  re-request" migration. One-directional follows don't map to a mutual
  friendship and are left behind, uncarried (this is a dev database with
  no real user base yet, so that asymmetry is low-stakes).

### Query hooks — `src/services/api/queries/community.ts` (edited in place, no new file)

- **`useFriendRelationships(userId)`** — one query fetching every
  `friend_requests` row the user participates in, reduced client-side
  into `{ friendIds: Set, outgoingByAddressee: Map, incomingByRequester:
  Map }`. This one hook backs every "what's my relationship with this
  other profile" lookup in the app — screens call the pure function
  `resolveFriendRequestState(relationships, otherUserId)` per row instead
  of running a hook per list item (same "batch fetch once, derive per
  item without hooks-in-a-loop" pattern used throughout
  `docs/ai-coaching.md`, e.g. `usePreviousPerformanceForExercises`).
- **`useIncomingFriendRequests(userId)`** — pending requests addressed to
  the user, joined to `public_profiles` client-side (two queries + a
  `Map` merge, same pattern `fetchLeaderboard`/`fetchFriendProfile`
  already used — `public_profiles` is a security-definer view, not
  FK-embeddable via PostgREST from `friend_requests`, so this two-step
  fetch is the correct approach here, not a shortcut).
- **`useSendFriendRequest(userId)`** — inserts a pending row, *unless* the
  other person already sent one (a reverse pending row exists), in which
  case it accepts theirs instead of inserting a duplicate — avoids a
  "you both requested each other" dead end.
- **`useAcceptFriendRequest`/`useDeclineFriendRequest`/`useRemoveFriendRequest`**
  — status update / status update / delete, respectively. Authorization
  is enforced entirely by the RLS policies above; these mutations don't
  duplicate that check client-side (consistent with every other
  status-transition mutation in this codebase).
- **`fetchLeaderboard`/`fetchActivityFeed`** internals now resolve
  "friend ids" instead of "following ids" — same functions, same shape,
  different source query. Their public hooks (`useLeaderboard`,
  `useActivityFeed`) are unchanged.
- `useFollowingIds`/`useFollowMutation`/`useUnfollowMutation` were
  **removed** (not kept alongside the new hooks) — nothing calls them
  after this migration, and keeping dead code that reads/writes an
  unused table would itself be the "duplicate social model" the original
  request warned against.

### UI

- **`src/components/core/FriendRequestButton.tsx`** (new) — the one
  relationship-action control, shared by `LeaderboardScreen`'s search
  results, its incoming-requests card, and `FriendProfileScreen`. Renders
  by `FriendRequestState`: `'none'` → "Add Friend"; `'outgoing'` →
  "Requested" (tap → confirm-cancel via `Alert.alert`, same
  confirm-destructive pattern `LibraryScreen`'s delete-workout flow
  already uses); `'incoming'` → Accept + Decline pair; `'friends'` →
  "Friends" (tap → confirm-remove).
- **`LeaderboardScreen.tsx`**: search results' trailing button now drives
  through `FriendRequestButton`; a new card at the top shows incoming
  pending requests (name + Accept/Decline) when any exist — no new
  screen, since this is already the community hub and a dedicated inbox
  screen isn't warranted for what's usually 0-2 pending requests. The
  leaderboard's scope (who's ranked alongside "you") changed from "who
  you follow" to "your accepted friends", with no visible copy change
  needed beyond the empty-state text ("follow" → "add").
- **`FriendProfileScreen.tsx`**: same `FriendRequestButton` in place of
  the old Follow/Unfollow toggle.

## Known limitation: no requests-inbox screen

Incoming requests only surface inline on `LeaderboardScreen`'s community
hub. If pending-request volume ever grows past a handful, a dedicated
inbox screen (and probably a badge on the Community tab icon) would be
the natural next step — not built now since nothing in this phase's
scope needed it.

## Phase 2 — Blocked users + shared filtering

### Migration `supabase/migrations/0018_blocked_users.sql`

- **`blocked_users`** — `blocker_id`, `blocked_id`, `created_at`,
  `primary key (blocker_id, blocked_id)`, no-self-block check. RLS:
  **both** participants can `select` (the blocked party needs to be able
  to detect the block too — mutual invisibility requires both sides to
  see it, not just the blocker); only the blocker can `insert`/`delete`
  (you can only create or undo your own blocks, never someone else's).

### Query hooks — `src/services/api/queries/community.ts` (edited in place)

- **`fetchBlockedIds(userId)`** (internal) — the one bidirectional
  "who's blocked-with-me" lookup, reused by every filtering point below
  rather than each reimplementing the OR-query. Returns a `Set<string>`
  for O(1) membership checks at each call site.
- **Filtering wired into existing functions** (not new endpoints — the
  same functions callers already use, doing more now): `fetchFriendIds`,
  `fetchFriendRelationships`, and `fetchIncomingFriendRequests` all
  exclude blocked ids from their output; `searchProfiles` excludes
  blocked-either-direction profiles entirely; `useSendFriendRequest`
  checks blocked status first and throws before inserting. This is
  intentionally defensive/layered — blocking already deletes the
  underlying `friend_requests` row (below), so most of this filtering
  is a second guarantee, not the only one.
- **`useBlockUser(userId)`** — deletes any `friend_requests` row between
  the two users (either direction, any status) *then* inserts the block
  row, in that order — blocking always severs an existing or pending
  relationship first.
- **`useUnblockUser(userId)`** / **`useBlockedUsers(userId)`** (list, for
  the management screen — blocker_id = the current user specifically,
  not bidirectional, since you can only unblock your own blocks) /
  **`useIsBlocked(userId, otherId)`** (bidirectional, for the profile
  screen's defensive guard below).

### UI

- **`FriendProfileScreen.tsx`** (edit): a `moreVertical` overflow button
  in the header (`Header`'s existing `right` slot) opens a `BottomSheet`
  with a single "Block {name}" row, confirmed via `Alert.alert` (same
  destructive-confirm pattern as `LibraryScreen`'s delete-workout flow).
  If `useIsBlocked` resolves true for the viewed profile, the screen
  renders a plain "This profile is unavailable" state instead of the
  normal profile UI — covers stale deep links, since normal navigation
  (search/leaderboard) no longer surfaces a blocked profile to reach in
  the first place.
- **`src/screens/profile/BlockedUsersScreen.tsx`** (new) + a "Blocked
  Users" row in `SettingsScreen.tsx`'s existing account card — the only
  place to unblock someone, since a blocked user no longer appears in
  search once blocked (there'd be no other way to find them again).

### Known limitation: no "muted" users

The original spec's filtering list mentions blocked *and* muted users,
but no UI/flow for a distinct "mute" appears anywhere else in it (no
Mute button, no Settings entry). Blocking covers the practical need
here. A lighter one-directional mute (hide their content from me
without severing the relationship or hiding my content from them) is a
plausible future addition, deliberately not built now.

## Phase 3 — Posts model + photo upload

### Scope: write path only

A `posts` table, a private Storage bucket, and the upload screen/flow.
Reading posts back (a feed, "my posts" on a profile) is Phase 4's job,
which will also decide how workout-completed and PR "posts" work — most
likely computed/joined at query time from the tables that already own
that data (`workout_logs`, `computePrEvents`), not duplicated into
`posts`, matching "do not create duplicate post models." Building the
read path now would mean guessing at Phase 4's design before it's
planned with full context, so `post_type` only has the two values this
phase actually creates (`progress_photo`, `before_after_photo`) —
`alter type ... add value` is a normal, low-risk way to extend it later
if `workout_completed`/`personal_record`/`streak_milestone`/`general`
turn out to need to be real rows after all.

### Migration `supabase/migrations/0019_posts.sql`

- **`posts`** — `user_id`, `post_type`, `visibility` (default `friends`),
  `caption`, `photo_path` / `before_photo_path` / `after_photo_path`
  (only the columns relevant to the row's `post_type` are populated).
- **Privacy enforced server-side at two layers**, since photo content is
  the actual sensitive payload here, not just a row to hide:
  1. **`posts` RLS** — a private post's row is selectable only by its
     owner; a friends-visible post's row is selectable by the owner or an
     accepted, non-blocked friend (the same `friend_requests`/
     `blocked_users` EXISTS-subquery shape Phase 1/2 already established
     for their own RLS policies, reused here rather than inventing a new
     check pattern).
  2. **Storage RLS via path-encoded visibility** — photos upload to
     `post-photos/{userId}/{visibility}/{filename}`, i.e. `private` or
     `friends` literally appears in the path. This means Storage RLS
     never needs to join back to `posts` to know a specific file's
     visibility (which would require fragile path-to-row matching) — a
     `private`-path object is only selectable by its owner; a
     `friends`-path object is selectable by the owner or an accepted,
     non-blocked friend of that folder's owner. A private photo can never
     be fetched by anyone but its owner, even with the exact path.
  - **Known limitation**: changing a post's visibility after upload isn't
    supported this phase — the photo would need to move to a new storage
    path to match. Not asked for; documented rather than silently
    dropped.
- Unlike `avatars` (Milestone 11), the `post-photos` bucket is **not
  public** — `public: false`. A public bucket would make "Private" purely
  cosmetic, since anyone with the URL could load the file regardless of
  what the `posts.visibility` column said.

### Query hooks — `src/services/api/queries/posts.ts` (new)

- **`buildPostPhotoPath(userId, visibility, extension)`** (exported,
  pure) — the one place the `{userId}/{visibility}/{filename}` convention
  is encoded, directly unit-tested.
- **`useCreatePhotoPost(userId)`** — one mutation, a discriminated
  `{ mode: 'progress' | 'before_after'; ... }` param. Uploads one or two
  photos (mirrors `useUploadAvatar`'s fetch-URI→arrayBuffer→
  `.storage.upload()` sequence from `profiles.ts`, just to the private
  bucket instead of the public `avatars` one and without the
  cache-busting public-URL step, since there's no public URL here), then
  inserts the `posts` row with the right `post_type` and path column(s).

### UI

- **`src/components/core/VisibilitySelector.tsx`** (new) — thin wrapper
  around the existing `SegmentedControl` (already exactly a "pick one of
  two options" control) with a "VISIBILITY" label and a one-line caption
  that swaps with the selection. `SegmentedControl` itself gained
  `accessibilityRole="radio"` / `accessibilityState`/`accessibilityLabel`
  in passing — a small, safe improvement that benefits every existing
  consumer (e.g. Settings' units toggle), not just this new one.
- **`src/screens/progress/UploadPhotoPostScreen.tsx`** (new) — route
  param `{ mode: 'progress' | 'before_after' }` picks the title and
  whether one or two photo pickers render (`launchImageLibrary`, same
  `{ mediaType: 'photo', quality: 0.8 }` options `ProfileScreen`'s avatar
  flow already uses), an optional caption, the new `VisibilitySelector`
  (defaults to Friends), and a "Post" button.
- **`ProgressDashboardScreen.tsx`**: two new rows, "Post Progress Photo" /
  "Post Before & After", in the existing navigation card.

### Deferred to Phase 4 (not forgotten, just not this phase's job)

- `VisibilityBadge` (a small "👥 Friends" / "🔒 Private" pill) — there's
  nowhere to render one yet; building it with no consumer would be
  premature.
- Signed-URL fetching for displaying an already-uploaded photo — the
  upload screen only ever shows the local picked-image URI (no need to
  round-trip through Storage to preview what you just picked), so this
  phase never needed to touch `createSignedUrl`. Phase 4's feed/profile
  screens will be the first real caller.

## Phase 4 — Feed unification

### Scope narrowed from the roadmap's one-line description

The roadmap listed this phase as "feed unification... new detail
screens, reactions + comments." Same as Phase 3 turned out narrower than
its one-liner once actually researched, this phase does **not** include
reactions/comments or PR/streak-milestone feed items:

- **Reactions + comments** need two new tables with their own RLS (you
  can only react/comment on a post you're allowed to *see* — the same
  visibility check `posts` RLS already does, duplicated onto two more
  tables). That's a self-contained vertical slice on par with Phase 3
  itself, not a footnote on this one.
- **PR-in-feed** needs a *new* server-side exposure — `workout_log_sets`
  is owner-only RLS today, and `activity_feed`'s own definition
  deliberately excludes set-level detail. Surfacing a friend's PR means a
  new security-definer view that replicates `computePrEvents`'s "is this
  set a new best for this exercise" logic *in SQL* (a window-function
  query) — a distinct, non-trivial piece of logic to get right and verify
  against the existing TypeScript implementation, not a quick addition.
- **Streak-milestone / general posts** have no upload flow or storage
  anywhere (streaks are computed client-side from the *viewer's own* data
  via `computeStreak`, never exposed to others; "general post" was never
  buildable through anything built in Phase 3).

All four remain deferred (not silently dropped) to a future phase.

### Query layer

- **`src/services/api/queries/community.ts`** (edit) — `fetchFriendIds`
  and `fetchPublicProfiles` changed from private to exported; both
  already did exactly what the new feed code needs (friend-id resolution
  with blocking already baked in, and batch profile lookup), so exporting
  avoids reimplementing either.
- **`src/services/api/queries/posts.ts`** (edit) — added
  `useUserPosts(targetUserId)` (every `posts` row for one user, newest
  first — no client-side visibility filtering needed, since Phase 3's RLS
  already guarantees a private post is only ever returned to its owner,
  so the same query is correct for both "my own profile" and "a friend's
  profile"), `usePost(postId)` (single post, for the detail screen),
  `useSignedPhotoUrls(paths)` (one batched
  `supabase.storage.from('post-photos').createSignedUrls(paths, 3600)`
  call keyed by path, not one request per photo), and `postPhotoPaths(post)`
  (pure helper — every storage path a post references, shared by both
  profile posts grids, `PostDetailScreen`, and `ActivityFeedScreen`).
- **`src/services/api/queries/feed.ts`** (new) — composes the two domains
  above rather than living in either: `useFeed(userId)` resolves friend
  ids once, fetches `activity_feed` rows and `posts` rows scoped to those
  friend ids in parallel, and merges them into one `FeedEntry[]`
  (discriminated union over `workout_completed` / `progress_photo` /
  `before_after_photo`) sorted newest-first and capped at 30. The
  merge+sort itself, `mergeFeedEntries`, is exported separately from the
  fetch so it's directly unit-testable without mocking Supabase.

### UI

- **`src/components/core/VisibilityBadge.tsx`** (new, deferred from
  Phase 3 since it had no consumer yet) — `"👥 Friends"` / `"🔒 Private"`
  pill with a screen-reader `accessibilityLabel` override so it doesn't
  just announce an emoji.
- **`src/components/core/PostThumbnail.tsx`** (new) — square photo tile
  shared by both profile screens' posts grids; `before_after` posts show
  a split before|after preview. Takes already-resolved signed URLs as
  props (batched upstream), never fetches per-thumbnail.
- **`src/screens/community/PostDetailScreen.tsx`** (new) — one screen for
  both post types, branching on the fetched post's `post_type` rather
  than being two near-identical files. Owner avatar/name header (tap →
  `FriendProfile`, inert on your own post), the photo(s) via
  `useSignedPhotoUrls`, caption, and a `VisibilityBadge` shown only when
  viewing your own post (a friend can never receive a private one to
  view in the first place, so the badge would always read "Friends" on
  their view and add no information). Registered as
  `PostDetail: { postId: string }` in **both** `CommunityStackParamList`
  and `ProfileStackParamList` — same "one component, registered in every
  stack that pushes it" precedent `ExerciseDetailScreen` already uses
  across `LogStackParamList`/`TodayStackParamList`.
- **`ActivityFeedScreen.tsx`** (edit) — reads `useFeed` instead of
  `useActivityFeed`. `workout_completed` entries render unchanged (tap →
  `FriendProfile`, since there's still no workout-log detail screen
  anywhere in the app); `progress_photo`/`before_after_photo` entries
  render a richer card (avatar/name/timestamp header, photo preview(s)
  via a batched `useSignedPhotoUrls` call across every photo path on the
  current page, caption) — tap navigates to `PostDetail`.
- **`FriendProfileScreen.tsx`** (edit) — a "Posts" section below the
  existing stats/friend-button content, from `useUserPosts(params.userId)`
  rendered as `PostThumbnail` tiles — no visibility badge, since every
  row returned is already friends-visible by construction (RLS).
- **`src/screens/profile/ProfileScreen.tsx`** (edit) — matching "Posts"
  section from `useUserPosts(userId)` (own id), each tile paired with a
  `VisibilityBadge` since both private and friends posts are visible to
  the owner. The screen's outer layout changed from a fixed `View` to a
  `ScrollView` to fit a growing posts grid; "Sign Out" moved from
  pinned-to-bottom to the end of the scrollable content.

## Phase 5 — Home "Friends Activity" section

All the data plumbing this needed already existed from Phase 4 —
`useFeed` and `useSignedPhotoUrls`. This phase is client-side selection
and presentation only: no migration, no new query.

### Query layer — `src/services/api/queries/feed.ts` (edit)

- **`selectFriendsActivityPreview(entries, limit = 3)`** (exported, pure,
  next to `mergeFeedEntries` for the same directly-unit-testable reason)
  — "3 most recent, photo posts prioritized" implemented as: partition
  the already-recency-sorted feed into photo entries and workout
  entries (each partition keeps its own recency order), concatenate
  photos first, then workouts, then slice to the limit. If there are
  ≥3 recent photo posts, only photos show; otherwise the most recent
  workouts fill the remaining slots — never an empty preview just
  because photos are scarce.

### Analytics — `src/services/analytics/analytics.ts` (edit)

Four new names added to the `AnalyticsEvent` union (still just a dev
`console.log` — no provider is wired up yet, per the file's own
comment): `friends_activity_viewed` (`{ count }`, fired once when the
section first resolves to real content — not while loading or errored),
`friends_activity_card_tapped` (`{ entry_type }`), 
`friends_activity_view_all_tapped`, `friends_activity_retry_tapped`.

### UI — new components in `src/screens/home/` (co-located with
`WeekTimeline.tsx`, the existing precedent for a screen-specific
composed component that receives data via props rather than fetching
its own)

- **`FriendsActivitySkeleton.tsx`** — static placeholder (no shimmer —
  nothing in the app has a shimmer/motion skeleton pattern to extend,
  and a static block trivially satisfies "don't shift layout while
  loading" with no reduced-motion handling needed). Wrapped with a
  single `accessibilityLabel="Loading friends activity"` and
  `importantForAccessibility="no-hide-descendants"` on the placeholder
  blocks, so a screen reader announces the label once instead of three
  empty shapes.
- **`FriendActivityCard.tsx`** (wrapped in `React.memo`, since
  `TodayScreen` re-renders fairly often from its own state) — one
  entry, branching on `entry.type` in a single component rather than
  separate progress/before-after/workout card components (same "branch
  on type" precedent `PostDetailScreen`/`PostThumbnail` already use):
  avatar, name, relative timestamp (`formatDistanceToNow`, same as
  `PostDetailScreen`), and a small thumbnail for photo entries (receives
  an already-resolved signed URL as a prop — for a before/after entry
  this is just the "before" photo, since a compact preview only needs
  one image). `accessibilityRole="button"` with a full descriptive
  label (e.g. "Friend One completed Push Day, 2 hours ago").
- **`FriendsActivitySection.tsx`** — the container: header ("Friends
  Activity" + a small ghost "View All" button, hidden while loading,
  errored, or empty since there's nothing to view), then one of the
  skeleton, an `EmptyState`-based error block ("Couldn't load Friends
  Activity." + Retry), an `EmptyState` empty block ("No friend activity
  yet" — same phrasing style `ActivityFeedScreen`'s empty state already
  uses), or up to 3 `FriendActivityCard`s. Pure props in, no fetching of
  its own — same split `WeekTimeline` already established.

### `TodayScreen.tsx` (edit)

- `useFeed(userId)` alongside the screen's existing data hooks;
  `selectFriendsActivityPreview` over the result; `useSignedPhotoUrls`
  batched across just the previewed entries' photo paths (never all 30
  feed rows — only what's actually rendered).
- Renders `<FriendsActivitySection>` right after the greeting header,
  before the program-day content — visible regardless of whether the
  viewer has an active program.
- Card taps and "View All" navigate into `CommunityTab` via the same
  nested-navigate-bubbles-to-root pattern this file's existing
  `goToScheduledDetail` already relies on (`rootNavigation.navigate('MainTabs', { screen: 'CommunityTab', params: {...} })`).
- `useFeed(userId)` here shares the exact `['feed', userId]` cache key
  `ActivityFeedScreen` already queries — no redundant fetch when a user
  taps "View All" into the full feed right after seeing the preview.
- `trackEvent` fires at each of the four Phase 5 analytics points.

## Testing

- `src/services/api/queries/__tests__/community.test.ts` — `resolveFriendRequestState`
  covers all four states, the "not loaded yet" case, and that an existing
  friendship takes priority over any stale pending-request map entries
  for the same id.
- `src/screens/community/__tests__/LeaderboardScreen.test.tsx` (new — the
  screen had no test file before this pass) — the incoming-requests card
  renders and its Accept/Decline buttons call the right mutations with
  the right request id; leaderboard row navigation still works.
- `src/screens/community/__tests__/FriendProfileScreen.test.tsx` (new,
  extended in Phase 2) — all four `FriendRequestButton` states render
  the right label/actions and call the right mutation with the right
  id; the block flow calls `useBlockUser` with the right id after the
  `Alert.alert` confirm; the "profile unavailable" state renders instead
  of the normal profile when `useIsBlocked` is true.
- `src/screens/profile/__tests__/BlockedUsersScreen.test.tsx` (new) —
  renders blocked profiles, "Unblock" calls the mutation with the right
  id, empty state when none.
- `src/services/api/queries/__tests__/posts.test.ts` (new) —
  `buildPostPhotoPath` puts the right visibility segment in the path for
  both values, and never produces the same filename twice.
- `src/screens/progress/__tests__/UploadPhotoPostScreen.test.tsx` (new) —
  progress mode renders one photo picker, before/after mode renders two;
  visibility defaults to Friends; switching it, picking a photo, and
  entering a caption all flow through correctly into the
  `useCreatePhotoPost` call; Post stays disabled until the required
  photo(s) are picked.
- `src/services/api/queries/__tests__/feed.test.ts` (new) —
  `mergeFeedEntries` sorts a mix of workout/photo/before-after entries
  newest-first and respects the cap.
- `src/screens/community/__tests__/ActivityFeedScreen.test.tsx` (new —
  the screen had no test file before this pass) — renders one of each
  entry type correctly; tapping a photo entry navigates to `PostDetail`;
  tapping a workout entry still navigates to `FriendProfile`; empty
  state renders with no activity.
- `src/screens/community/__tests__/PostDetailScreen.test.tsx` (new) —
  renders a progress-photo post and a before/after post correctly (right
  number of images, caption); shows the `VisibilityBadge` only when the
  viewer owns the post.
- `src/screens/community/__tests__/FriendProfileScreen.test.tsx`
  (extended) — the new Posts section renders `useUserPosts` results with
  no visibility badges.
- `src/screens/profile/__tests__/ProfileScreen.test.tsx` (new — the
  screen had no test file before this pass) — renders profile details;
  the Posts section renders with a `VisibilityBadge` reflecting each
  post's actual visibility; tapping a thumbnail navigates to
  `PostDetail`; (**superseded below** — the section is now always
  visible, including with zero posts).
- `src/services/api/queries/__tests__/feed.test.ts` (extended) —
  `selectFriendsActivityPreview` prioritizes photo entries over workout
  entries, fills remaining slots with the most recent workouts when
  there are fewer photos than the limit, and respects the limit.
- `src/screens/home/__tests__/FriendsActivitySection.test.tsx` (new) —
  renders the skeleton while loading; renders cards from given entries
  and calls `onCardPress`/`onViewAllPress` with the right arguments;
  renders the error state and calls `onRetry` on tap; renders the empty
  state (no "View All") when there are no entries.
- `src/screens/home/__tests__/TodayScreen.test.tsx` (extended) — the
  Friends Activity section renders from `useFeed` data; "View All"
  navigates into the Community tab's activity feed.

## Post-launch adjustments (Home reorder + "my posts" discoverability)

Two follow-up requests came in right after Phase 5 shipped:

1. **Friends Activity moved** from directly under the Home greeting to
   below the today's-workout-summary card, and `TodayScreen`'s
   `ScrollView` gained pull-to-refresh (`RefreshControl`, first use in
   this codebase) refetching program/workout-logs/scheduled-workouts/
   logged-sets/feed together — see `docs/ai-coaching.md`'s Phase 12
   entry for the AI Summary card that now sits at the very top instead.
2. **"Where do I view my own posts?"** — `ProfileScreen`'s Posts section
   (Phase 4) only rendered when `posts.length > 0`, so a user with zero
   posts saw no trace of the feature at all. Fixed: the "POSTS" section
   is now always rendered — an `EmptyState` with a "Post a Photo" action
   when empty, a "+" `IconButton` next to the label once there are posts
   — both opening a `BottomSheet` (same pattern `FriendProfileScreen`'s
   overflow menu uses) with "Post Progress Photo"/"Post Before & After",
   navigating to the same `UploadPhotoPost` screen
   `ProgressDashboardScreen`'s existing rows already use (a second entry
   point to the same flow, not a new one — `ProgressDashboardScreen` is
   untouched).

## Phase 6 — Instagram-style posts hub, mixed feed removed

Reframed the whole "activity" concept around **posts** specifically —
friends' completed workouts are no longer shown anywhere in Community or
on Home (a deliberate product decision, not an oversight: confirmed via
explicit user sign-off before building). `docs/ai-coaching.md`'s AI
Summary card (Phase 12) is the only place workout context still surfaces
on Home.

### Deleted

`src/services/api/queries/feed.ts` and its test — `useFeed`,
`mergeFeedEntries`, `selectFriendsActivityPreview`, `FeedEntry` had no
remaining callers once Home and Community were rebuilt on posts
directly (confirmed by grep before deleting). `src/screens/community/ActivityFeedScreen.tsx`
and its test were replaced outright (see below), not edited in place.

### New query — `src/services/api/queries/posts.ts` (edit)

`FriendPost = Post & { displayName, avatarUrl }` / `useFriendsPosts(userId)`
— resolves friend ids (`fetchFriendIds`, already exported from
`community.ts`), fetches `posts` scoped to those ids newest-first
(capped at 60 — same "no pagination yet" scope-limit `feed.ts`'s
`FEED_LIMIT` already had at 30, same reasoning), batch-joins author
`display_name`/`avatar_url` via `fetchPublicProfiles`. **One hook now
backs both** Home's 3-post preview (`.slice(0, 3)`, no priority logic
needed since the query is already posts-only and newest-first — the old
`selectFriendsActivityPreview`'s "prioritize photos" logic is gone
because everything already is a photo) and the Community "Posts" grid's
full list.

### Shared grid — `src/screens/community/PostsGrid.tsx` (new)

Full-bleed 3-column grid (`useWindowDimensions` sizes tiles to
`width / 3`, same hook `LoadingScreen.tsx` already uses elsewhere),
reusing `PostThumbnail` per tile. Takes plain `Post[]` (not `FriendPost[]`)
since grid tiles don't need author info — shared as-is by both screens
below rather than writing the grid layout twice.

### Community tab restructure

- **`ActivityFeedScreen.tsx` → `CommunityPostsScreen.tsx`** (replaced,
  not edited): `useFriendsPosts` + `PostsGrid`. `Header title="Posts"`
  with a `right`-slot "My Posts" button (same slot pattern
  `FriendProfileScreen`'s overflow button already uses) → `MyPosts`.
  Tile tap → `PostDetail` (unchanged destination from Phase 4).
- **`MyPostsScreen.tsx`** (new) — `useUserPosts` (Phase 4, unchanged) +
  the same `PostsGrid`. RLS already returns everything for the owner
  (private included), same guarantee `ProfileScreen`'s posts section
  already relies on — no visibility filtering needed here either.
- **`CommunityStackParamList`**: `ActivityFeed: undefined` renamed to
  `Posts: undefined`, plus new `MyPosts: undefined`.
- **`LeaderboardScreen.tsx`**: its header icon button now points at
  `Posts` (icon changed `activity` → `camera`). Nothing else on this
  screen changed — search, incoming requests, and leaderboard ranks are
  exactly Phase 1/2's implementation, which is what "keep the friend
  search in the Community tab" already meant.

### Home (`src/screens/home/`)

- **`FriendActivityCard.tsx`**: dropped the `FeedEntry` union and the
  `workout_completed` branch — takes a `FriendPost` directly.
- **`FriendsActivitySection.tsx`**: `posts: FriendPost[]` prop instead
  of `entries: FeedEntry[]`; loading/error/empty/list structure and the
  `onRetry`/`onCardPress`/`onViewAllPress` callback shape are unchanged
  from Phase 5.
- **`TodayScreen.tsx`**: `useFriendsPosts` + `.slice(0, 3)` instead of
  `useFeed` + `selectFriendsActivityPreview`; "View All" and
  pull-to-refresh (Post-launch adjustments, above) now target
  `useFriendsPosts`'s `refetch` and the `Posts` route.
- **Analytics** (`src/services/analytics/analytics.ts`): the four Phase
  5 event names renamed for the posts-only framing —
  `friends_activity_*` → `friends_posts_*` (`_viewed`, `_card_tapped`,
  `_view_all_tapped`, `_retry_tapped`). Still just the dev-log
  `trackEvent`, no real provider wired up.

### Testing

- `src/screens/community/__tests__/CommunityPostsScreen.test.tsx` (new,
  replaces the deleted `ActivityFeedScreen.test.tsx`) — renders a tile
  per friend post, tap → `PostDetail`, "My Posts" button → `MyPosts`,
  empty state with no friend posts.
- `src/screens/community/__tests__/MyPostsScreen.test.tsx` (new) —
  renders a tile per own post, tap → `PostDetail`, empty state.
- `src/screens/community/__tests__/LeaderboardScreen.test.tsx`
  (extended) — header button navigates to `Posts`. (**superseded below**
  — this screen no longer has a header button at all; see the Phase 6
  correction section.)
- `src/screens/home/__tests__/FriendsActivitySection.test.tsx`
  (rewritten for `FriendPost[]` props).
- `src/screens/home/__tests__/TodayScreen.test.tsx` (edited) — mocks
  `useFriendsPosts` instead of `useFeed`; "View All" and pull-to-refresh
  assertions updated to match.
- `PostsGrid` has no standalone test file — covered through the two
  screens that use it, matching this codebase's existing precedent
  (`PostThumbnail`, `VisibilityBadge`, `WeekTimeline` have no dedicated
  test files either).

## Phase 6 correction — the grid needs to be the landing screen, not a tap away

Right after Phase 6 shipped, the actual problem became clear: the grid
was real and working, but Community's landing screen was still
`LeaderboardScreen` (rankings + a small search box), with the grid one
tap behind a small camera icon in its header — easy to miss entirely,
which is exactly what happened. Also caught in the same pass: `PostsGrid`
was never wrapped in a `ScrollView` in either consuming screen, so a
grid with more than one screen's worth of tiles couldn't actually be
scrolled to see the rest.

- **`CommunityPostsScreen.tsx` is now the Community tab's landing
  screen** (`CommunityStack`'s `initialRouteName="Posts"`). It absorbed
  `LeaderboardScreen`'s search box, search-results list, and incoming
  friend-requests card — all the exact same query hooks and rendering
  `LeaderboardScreen` used, just moved — so from the moment you open
  Community you see: search bar → (search results, or incoming requests
  + the friends' posts grid) → header buttons for "Leaderboard" (trophy
  icon) and "My Posts" (user icon, unchanged from Phase 6).
- **`LeaderboardScreen.tsx`** is now rankings-only, reachable via the
  trophy button — a normal `Header`-based secondary screen like every
  other pushed screen in the app, no longer hand-rolling its own top bar.
- **`PostsGrid` usages wrapped in `ScrollView`** in both
  `CommunityPostsScreen` and `MyPostsScreen` — the grid itself stays a
  plain `View` (so it can be embedded next to other scrollable content,
  which `CommunityPostsScreen` now needs), the fix is at each call site.
- Searching a specific user still lands on `FriendProfileScreen`
  (unchanged since Phase 4), which already has that person's posts grid
  in its own "Posts" section — this is what satisfies "search a user to
  view their photos."

### Testing (Phase 6 correction)

- `src/screens/community/__tests__/CommunityPostsScreen.test.tsx`
  (extended) — search results render and a friend request can be sent
  from them; the incoming-requests card renders and Accept/Decline work;
  the Leaderboard and My Posts header buttons navigate correctly — on
  top of the existing grid/empty-state/tap-to-`PostDetail` coverage.
- `src/screens/community/__tests__/LeaderboardScreen.test.tsx`
  (rewritten) — renders ranks, row tap → `FriendProfile`, empty state
  when there are no friends yet. Search/requests assertions moved to
  `CommunityPostsScreen.test.tsx` above since that's where the behavior
  now lives.
