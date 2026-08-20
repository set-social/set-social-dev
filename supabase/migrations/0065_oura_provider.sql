-- Milestone 65: Oura Ring as a third wearable provider, part 1 — the enum
-- value. Same reason 0035_spotify_provider.sql is its own file: `alter
-- type ... add value` can't run in the same transaction as a statement that
-- reads the new value, so this migration does nothing else.

alter type public.integration_provider add value 'oura';
