-- Milestone 66: Oura Ring as a third wearable provider, part 2 — the metrics
-- table, mirroring whoop_metrics' shape/RLS posture (0025_whoop_metrics.sql)
-- but with Oura's own natural 3-score daily summary rather than a forced
-- 1:1 crosswalk to Whoop's fields: Whoop's strain (workout exertion) has no
-- Oura equivalent, Oura's activity_score (daily movement adequacy) has no
-- Whoop equivalent. Both are 3-metric daily summaries in spirit, not
-- identical metrics.
--
-- No score_state column, unlike whoop_metrics — Oura has no
-- PENDING_SCORE/SCORED/UNSCORABLE concept; a row for a given day simply
-- doesn't exist yet until Oura has scored it (see oura-sync), so "has data
-- for today" is just "a row exists for today's date."

create table public.oura_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  metric_date date not null,
  readiness_score smallint check (readiness_score between 0 and 100),
  sleep_score smallint check (sleep_score between 0 and 100),
  activity_score smallint check (activity_score between 0 and 100),
  synced_at timestamptz not null default now(),
  unique (user_id, metric_date)
);

alter table public.oura_metrics enable row level security;

-- Select-only for clients, same as whoop_metrics — only oura-sync's
-- service-role client ever writes here.
create policy "oura_metrics_select_own"
  on public.oura_metrics for select
  using (auth.uid() = user_id);
