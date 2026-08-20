-- Apple Health / Health Connect — see docs/apple-health.md. Adding both enum
-- values now even though Phase 1 (this migration's companion, 0079) only
-- ever writes 'apple_health' — Health Connect is Phase 2, sketched but not
-- built, and extending this enum is cheap and one-directional (Postgres
-- can't drop an enum value later, so there's no cost to reserving it now
-- the same way 0035/0065 added 'spotify'/'oura' one at a time).
--
-- Kept in its own migration, separate from 0079's table creation, matching
-- the existing convention (0035_spotify_provider.sql, 0065_oura_provider.sql
-- each did this alone) — an `alter type ... add value` can't be used in the
-- same transaction as a statement that references the new value, so this
-- stays isolated on principle even though 0079 doesn't actually need to.

alter type public.integration_provider add value 'apple_health';
alter type public.integration_provider add value 'health_connect';
