-- Milestone 25: cached WHOOP daily metrics (recovery/sleep/strain), synced
-- server-side by the whoop-sync edge function. Select-only RLS — unlike
-- integration_connections, the client never writes here directly, only
-- reads the latest synced row; all writes go through whoop-sync's
-- service-role client, same as oauth_states.

create table public.whoop_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  cycle_date date not null,
  -- Stable WHOOP-side id for the cycle this row was synced from — cycle
  -- boundaries follow sleep, not UTC midnight, so this (not cycle_date
  -- alone) is what makes re-syncs idempotent and gives a durable join key
  -- for later work (e.g. feeding the coaching engine).
  whoop_cycle_id text,
  -- SCORED | PENDING_SCORE | UNSCORABLE, per WHOOP's API. Lets the UI tell
  -- "no data yet today" apart from "recovery is genuinely 0" — a row can
  -- exist for today before WHOOP finishes scoring it.
  score_state text not null default 'PENDING_SCORE',
  recovery_score smallint check (recovery_score between 0 and 100),
  sleep_performance_pct smallint check (sleep_performance_pct between 0 and 100),
  -- WHOOP's strain scale is 0-21.
  strain numeric(4, 2),
  hrv_ms smallint,
  resting_heart_rate smallint,
  synced_at timestamptz not null default now(),
  unique (user_id, cycle_date)
);

alter table public.whoop_metrics enable row level security;

create policy "whoop_metrics_select_own"
  on public.whoop_metrics for select
  using (auth.uid() = user_id);
