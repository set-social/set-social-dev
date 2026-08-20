-- Milestone 82: GPS-tracked cardio routes — additive to cardio_log_entries
-- (0040), never replacing manual entry. A route is optional metadata on top
-- of the fields a manual session already fills in (duration/distance/
-- effort/calories); has_route is a cheap flag so list/history reads can
-- tell "this session has a route" without joining cardio_route_points.
-- See docs/gps-cardio.md for the full data-model reasoning (child table of
-- points vs. a single geometry/jsonb column).

alter table public.cardio_log_entries add column has_route boolean not null default false;
alter table public.cardio_log_entries add column avg_pace_sec_per_km integer;
alter table public.cardio_log_entries add column best_pace_sec_per_km integer;
-- Reserved, always null until a later pass adds elevation smoothing — see
-- docs/gps-cardio.md's "Known limitation: no elevation".
alter table public.cardio_log_entries add column elevation_gain_meters integer;

-- One row per captured GPS fix. Splits/pace are derived client-side from
-- this ordered array (src/utils/routeMetrics.ts) rather than persisted
-- separately — same "recompute, don't accumulate a second source of truth"
-- judgment call docs/ai-coaching.md made for PR predictions.
create table public.cardio_route_points (
  id uuid primary key default gen_random_uuid(),
  cardio_log_entry_id uuid not null references public.cardio_log_entries (id) on delete cascade,
  seq integer not null,
  latitude double precision not null,
  longitude double precision not null,
  recorded_at timestamptz not null,
  elevation_meters double precision,
  unique (cardio_log_entry_id, seq)
);

create index cardio_route_points_entry_id_idx on public.cardio_route_points (cardio_log_entry_id);

alter table public.cardio_route_points enable row level security;

-- Owner-only via the parent cardio_log_entries row — same "owner via
-- parent" shape workout_log_sets uses relative to workout_logs, since
-- cardio_route_points has no user_id column of its own.
create policy "cardio_route_points_all_own"
  on public.cardio_route_points for all
  using (
    exists (
      select 1 from public.cardio_log_entries
      where cardio_log_entries.id = cardio_route_points.cardio_log_entry_id
        and cardio_log_entries.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.cardio_log_entries
      where cardio_log_entries.id = cardio_route_points.cardio_log_entry_id
        and cardio_log_entries.user_id = auth.uid()
    )
  );
