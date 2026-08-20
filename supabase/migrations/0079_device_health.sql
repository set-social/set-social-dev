-- Apple Health / Health Connect, Phase 1 (iOS only) — see docs/apple-health.md
-- for the full plan and why this doesn't follow the Whoop/Oura shape.
--
-- Unlike whoop_metrics/oura_metrics (written server-side by a service-role
-- sync edge function, select-only RLS for the user), there is no
-- third-party API and no client secret here — the device itself is the only
-- source of this data. The client reads it locally via the platform SDK and
-- writes it here as itself, under the same auth.uid() = user_id RLS every
-- other user-authored table already uses (e.g. body_metrics). No
-- service-role writer exists for these two tables.

-- Permission-request state, NOT an OAuth token — there is nothing here to
-- exchange or refresh. A row's existence means "the athlete has gone
-- through the OS permission sheet at least once," never a live "currently
-- granted" flag: neither HealthKit nor Health Connect reliably tells the
-- app that (HealthKit deliberately never reports per-type grant/deny —
-- see docs/apple-health.md's "Permission UX" section). last_synced_at is
-- the only honest signal of whether reads are actually coming back with
-- data.
create table public.device_health_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  source public.integration_provider not null,
  requested_at timestamptz not null default now(),
  last_synced_at timestamptz
);

create unique index device_health_connections_user_id_source_key
  on public.device_health_connections (user_id, source);

alter table public.device_health_connections enable row level security;

create policy "device_health_connections_all_own"
  on public.device_health_connections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- One row per (user, date, source) — a user could in principle have both
-- 'apple_health' and 'health_connect' rows for the same date on different
-- devices; kept as separate rows rather than merged, same "let the caller's
-- precedence rule decide" posture docs/apple-health.md's "Precedence when
-- multiple sources report the same day" section describes for Whoop/Oura.
create table public.device_health_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  metric_date date not null,
  source public.integration_provider not null,
  resting_heart_rate smallint,
  hrv_ms smallint,
  -- Apple reports SDNN, Android Health Connect reports RMSSD — two
  -- different statistical measures of the same underlying signal, not
  -- directly comparable numbers. Stored explicitly so nothing (the engine,
  -- a future trend chart) ever averages or compares them by accident. See
  -- docs/apple-health.md's "HRV isn't the same number on both platforms".
  hrv_method text check (hrv_method in ('sdnn', 'rmssd')),
  sleep_duration_minutes smallint,
  step_count integer,
  synced_at timestamptz not null default now()
);

create unique index device_health_metrics_user_id_date_source_key
  on public.device_health_metrics (user_id, metric_date, source);

alter table public.device_health_metrics enable row level security;

create policy "device_health_metrics_all_own"
  on public.device_health_metrics for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
