-- Milestone 24: server-side CSRF / session-binding token for the WHOOP OAuth
-- handshake. Minted by whoop-oauth-start (authenticated, runs as the calling
-- user) and consumed once by whoop-oauth-callback (WHOOP's redirect target —
-- hit directly by the user's browser, no session available) to look up which
-- user an incoming `code` belongs to.
--
-- Only ever touched by those two edge functions via the service-role key —
-- RLS is enabled with no policies at all, so no client (anon or
-- authenticated) can read, write, or delete rows here directly.

create table public.oauth_states (
  state uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider public.integration_provider not null,
  created_at timestamptz not null default now()
);

alter table public.oauth_states enable row level security;
