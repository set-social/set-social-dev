-- Milestone 35: add Spotify as a second integration_connections /
-- oauth_states provider, alongside Whoop (see migrations 0023/0024). No new
-- tables needed — both are already provider-generic.
--
-- `alter type ... add value` can't run in the same transaction as a
-- statement that reads the new value, so this migration does nothing else.

alter type public.integration_provider add value 'spotify';
