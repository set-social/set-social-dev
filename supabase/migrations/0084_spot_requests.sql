-- Milestone 84: "Request a Spot" — a checked-in athlete mid-exercise can ask
-- every other athlete currently checked in nearby (same 150m radius
-- nearby_checkins() already established, 0037_gym_checkins.sql) to come spot
-- them, with the specific exercise/set/weight carried along so the request
-- means something before anyone taps it. See docs' reviewed mockup: the CTA
-- lives on the exercise screen itself, not At My Gym — spotting is
-- exercise-scoped, not a general "I'm at the gym" broadcast.
--
-- Two things this schema deliberately does NOT do, both mirroring
-- gym_checkins' own posture:
--   1. No plain cross-user SELECT policy — a nearby athlete only ever learns
--      about a pending request via get_spot_request(), which re-checks
--      proximity server-side rather than trusting "you knew the id" alone.
--   2. No client-side UPDATE path for accept/decline — respond_to_spot_request()
--      re-verifies the responder is still within radius of the requester's
--      active check-in at response time (not just at send time), the same
--      trust boundary nearby_checkins() itself already uses. A broad RLS
--      update policy would let anyone who merely learned an id (e.g. a leaked
--      deep link) accept/decline without ever actually being nearby.

alter table public.profiles
  add column push_spot_requests_enabled boolean not null default true;

create type public.spot_request_status as enum ('pending', 'accepted', 'declined');

create table public.spot_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  -- Nullable: freestyle sessions have no workout_logs row at all until
  -- Finish (see activeWorkoutStore) — a spot request during one still needs
  -- to work, it just can't correlate back to a saved workout afterward.
  workout_log_id uuid references public.workout_logs (id) on delete set null,
  -- Snapshotted at request time, not looked up live — by the time anyone
  -- responds the athlete may already be two sets further along, and the
  -- notification/response card should keep showing what was actually true
  -- when they asked, same "point-in-time replay" reasoning coaching_summaries
  -- already established (docs/coaching-history.md).
  exercise_name text not null,
  set_number integer,
  load_kg numeric,
  status public.spot_request_status not null default 'pending',
  responder_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz
);

create index spot_requests_requester_id_idx on public.spot_requests (requester_id);
-- Supports respond_to_spot_request()'s existence/status check by id, and
-- get_spot_request() re-checking a specific pending row hasn't already
-- resolved out from under a slow responder.
create index spot_requests_pending_idx on public.spot_requests (id) where status = 'pending';

alter table public.spot_requests enable row level security;

-- Deliberately narrow: a nearby athlete who hasn't responded yet has no
-- direct SELECT access at all (see the file header) — they only ever see a
-- request's contents through get_spot_request() below.
create policy "spot_requests_select_participant" on public.spot_requests
  for select using (auth.uid() = requester_id or auth.uid() = responder_id);

create policy "spot_requests_insert_own" on public.spot_requests
  for insert with check (auth.uid() = requester_id);

-- Requester-only, and only for canceling — accept/decline never go through
-- this policy, only through respond_to_spot_request() below.
create policy "spot_requests_delete_requester" on public.spot_requests
  for delete using (auth.uid() = requester_id);

-- Distance check copied from nearby_checkins() (0037_gym_checkins.sql) —
-- same haversine formula, same "reference point is always read server-side
-- from the *caller's own* active check-in" reasoning, just parameterized
-- over an explicit target user instead of always being auth.uid(). Used by
-- both functions below so a request only ever surfaces to (or can be
-- resolved by) someone who is actually, currently, nearby.
create or replace function public.is_within_checkin_radius(p_user_id uuid, p_target_user_id uuid, p_radius_meters integer default 150)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.gym_checkins me
    join public.gym_checkins target on target.user_id = p_target_user_id and target.expires_at > now()
    where me.user_id = p_user_id
      and me.expires_at > now()
      and 6371000 * acos(
        least(1, greatest(-1,
          cos(radians(me.latitude)) * cos(radians(target.latitude))
            * cos(radians(target.longitude) - radians(me.longitude))
          + sin(radians(me.latitude)) * sin(radians(target.latitude))
        ))
      ) <= p_radius_meters
  );
$$;

grant execute on function public.is_within_checkin_radius(uuid, uuid, integer) to authenticated;

-- Read path for a request's full display details (requester name/avatar,
-- exercise context) — the only way anyone but the requester/responder ever
-- reads a spot_requests row's contents. Authorized for the requester, the
-- responder (re-opening a resolved request), or anyone currently within
-- radius of the requester (a legitimate potential responder who hasn't
-- acted yet). Returns no rows rather than erroring when unauthorized or
-- not found, matching nearby_checkins()' own "just comes back empty"
-- posture rather than a distinguishable 403.
create or replace function public.get_spot_request(p_request_id uuid)
returns table (
  id uuid,
  requester_id uuid,
  requester_display_name text,
  requester_avatar_url text,
  requester_avatar_focal_x numeric,
  requester_avatar_focal_y numeric,
  exercise_name text,
  set_number integer,
  load_kg numeric,
  status public.spot_request_status,
  responder_id uuid,
  created_at timestamptz,
  expires_at timestamptz,
  distance_meters double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sr.id,
    sr.requester_id,
    p.display_name,
    p.avatar_url,
    p.avatar_focal_x,
    p.avatar_focal_y,
    sr.exercise_name,
    sr.set_number,
    sr.load_kg,
    sr.status,
    sr.responder_id,
    sr.created_at,
    sr.expires_at,
    (
      select 6371000 * acos(
        least(1, greatest(-1,
          cos(radians(me.latitude)) * cos(radians(req.latitude))
            * cos(radians(req.longitude) - radians(me.longitude))
          + sin(radians(me.latitude)) * sin(radians(req.latitude))
        ))
      )
      from public.gym_checkins me, public.gym_checkins req
      where me.user_id = auth.uid() and me.expires_at > now()
        and req.user_id = sr.requester_id and req.expires_at > now()
    ) as distance_meters
  from public.spot_requests sr
  join public.profiles p on p.id = sr.requester_id
  where sr.id = p_request_id
    and (
      auth.uid() = sr.requester_id
      or auth.uid() = sr.responder_id
      or public.is_within_checkin_radius(auth.uid(), sr.requester_id)
    );
$$;

grant execute on function public.get_spot_request(uuid) to authenticated;

-- Accept/decline. security definer so it can write a row the caller doesn't
-- own under RLS — authorization is enforced entirely inside the function
-- body instead: the request must still be pending and unexpired, the caller
-- can't be the requester, and the caller must be within radius of the
-- requester's active check-in *right now* (re-checked at response time, not
-- trusted from whenever the push was sent — the requester or responder may
-- have moved, or the requester may have checked out, since then). `returns
-- setof` (not a bare composite) deliberately: a plain `returns
-- public.spot_requests` PL/pgSQL function always returns exactly one row
-- even when the UPDATE matched nothing (an all-NULL row, not an absent
-- one) — indistinguishable from a real result without inspecting every
-- field. setof lets "not respondable" come back as a genuine zero-row
-- result, which the client treats uniformly with get_spot_request()'s own
-- empty-means-unauthorized-or-gone posture.
create or replace function public.respond_to_spot_request(p_request_id uuid, p_accept boolean)
returns setof public.spot_requests
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.spot_requests
  set
    status = case when p_accept then 'accepted' else 'declined' end,
    responder_id = auth.uid(),
    responded_at = now()
  where id = p_request_id
    and status = 'pending'
    and expires_at > now()
    and requester_id <> auth.uid()
    and public.is_within_checkin_radius(auth.uid(), requester_id)
  returning *;
end;
$$;

grant execute on function public.respond_to_spot_request(uuid, boolean) to authenticated;

-- Fan-out push to every nearby, opted-in, checked-in athlete — resolved
-- entirely inside send-push's resolveSpotRequest (one edge function call,
-- not one trigger per recipient), same division of labor
-- resolveFriendLiveNearby already established (0043_push_notifications.sql
-- comment: "every new-as-of-milestone-72 resolver" puts fan-out logic in
-- TS, not a PL/pgSQL loop).
create function public.spot_requests_push_on_insert()
returns trigger
language plpgsql
as $$
begin
  perform public.push_dispatch(jsonb_build_object('type', 'spot_request', 'request_id', new.id));
  return new;
end;
$$;

create trigger spot_requests_push_after_insert
  after insert on public.spot_requests
  for each row execute function public.spot_requests_push_on_insert();

-- Requester-facing "someone's coming" push — a courtesy nudge for if
-- they've since navigated away from the exercise screen (the primary
-- confirmation UX is in-place, polling this row's status while the sent
-- sheet is open; see SpotRequestSentSheet).
create function public.spot_requests_push_on_accept()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'pending' and new.status = 'accepted' then
    perform public.push_dispatch(jsonb_build_object('type', 'spot_request_accepted', 'request_id', new.id));
  end if;
  return new;
end;
$$;

create trigger spot_requests_push_after_update
  after update on public.spot_requests
  for each row execute function public.spot_requests_push_on_accept();
