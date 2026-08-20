-- Milestone 37: "At My Gym" — manual, expiring location check-ins for
-- nearby-athlete discovery. Deliberately NOT continuous/background location:
-- an athlete taps "I'm here" (one foreground GPS read), the check-in expires
-- on its own a few hours later, and there is no history kept beyond the
-- current row (one per user, overwritten on re-check-in).
--
-- gym_checkins has no cross-user select policy at all — the only way to
-- learn about *other* people's check-ins is the nearby_checkins() function
-- below, which runs security definer (so it can read every row) but only
-- ever returns a user_id + rounded distance, never anyone's raw
-- coordinates. Raw lat/lng for anyone but yourself never reaches the client.

create table public.gym_checkins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  checked_in_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.gym_checkins enable row level security;

create policy "gym_checkins_all_own"
  on public.gym_checkins for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Distance via the haversine formula (no PostGIS/earthdistance extension
-- needed — plain-old trig is plenty accurate at gym-parking-lot radii).
-- Takes no lat/lng from the caller: the reference point is always the
-- caller's *own* active check-in, read server-side. This is deliberate —
-- accepting an arbitrary coordinate as input would let anyone probe "who's
-- near this address" without ever actually being there themselves.
create or replace function public.nearby_checkins(p_radius_meters integer default 150)
returns table (user_id uuid, distance_meters double precision)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select latitude, longitude
    from public.gym_checkins
    where user_id = auth.uid() and expires_at > now()
  ),
  candidates as (
    select
      g.user_id,
      6371000 * acos(
        least(1, greatest(-1,
          cos(radians(me.latitude)) * cos(radians(g.latitude))
            * cos(radians(g.longitude) - radians(me.longitude))
          + sin(radians(me.latitude)) * sin(radians(g.latitude))
        ))
      ) as distance_meters
    from public.gym_checkins g
    cross join me
    where g.user_id <> auth.uid()
      and g.expires_at > now()
      and not exists (
        select 1 from public.blocked_users bu
        where (bu.blocker_id = auth.uid() and bu.blocked_id = g.user_id)
           or (bu.blocker_id = g.user_id and bu.blocked_id = auth.uid())
      )
  )
  select user_id, distance_meters
  from candidates
  where distance_meters <= p_radius_meters
  order by distance_meters asc;
$$;

grant execute on function public.nearby_checkins(integer) to authenticated;
