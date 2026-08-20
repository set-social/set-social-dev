-- Milestone 74: "More details" panel on the Stats tab's Whoop tile.
--
-- All ten columns below come back on the same two WHOOP v2 endpoints
-- whoop-sync/index.ts already calls (/recovery and /activity/sleep) — this
-- is a parsing gap, not a new API call. Nullable throughout: rows synced
-- before this migration (and any sync where WHOOP omits a field) simply
-- don't populate them, same as every other optional metric on this table.
--
-- Field-name confirmation caveat carried over from the rest of this file
-- (see whoop-sync/index.ts's own header comment): spo2_percentage /
-- skin_temp_celsius on /recovery, and sleep_efficiency_percentage /
-- sleep_consistency_percentage / respiratory_rate / stage_summary /
-- sleep_needed on /activity/sleep, reflect WHOOP's v2 API as of this
-- writing — confirm against the WHOOP Developer Dashboard before relying on
-- this in production.

alter table public.whoop_metrics
  add column sleep_efficiency_pct smallint check (sleep_efficiency_pct between 0 and 100),
  add column sleep_consistency_pct smallint check (sleep_consistency_pct between 0 and 100),
  -- Breaths per minute — WHOOP returns this with decimal precision.
  add column respiratory_rate numeric(4, 1),
  -- Sleep stage breakdown, in whole minutes (WHOOP's own units are
  -- milliseconds — converted at write time in whoop-sync, same
  -- round-to-what's-actually-displayed call as recovery_score/strain).
  add column rem_sleep_minutes integer,
  add column deep_sleep_minutes integer,
  add column light_sleep_minutes integer,
  add column awake_minutes integer,
  -- How far under the athlete's personal sleep need they are, in minutes.
  add column sleep_debt_minutes integer,
  add column spo2_pct numeric(4, 1) check (spo2_pct between 0 and 100),
  add column skin_temp_celsius numeric(4, 1);
