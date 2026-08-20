-- Adds a per-user IANA timezone, synced from the client's own
-- Intl.DateTimeFormat().resolvedOptions().timeZone on app start (see
-- useSyncTimezone). Nothing server-side has ever needed to know a user's
-- local time before now — the proactive-coach cron sweep (0059) is the
-- first: it needs to know when it's locally evening for a given user to
-- reproduce StreakRiskNudge's client-side "hour >= 17" check, which a cron
-- job has no other way to determine. Null until a client syncs one (the
-- sweep treats a null timezone as UTC rather than skipping the user
-- entirely).
alter table public.profiles
  add column timezone text;
