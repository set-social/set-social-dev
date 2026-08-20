-- Milestone 23: third-party integration credentials (Whoop first, more
-- providers later). No provider is actually called from the app yet — this
-- only wires up storage so a user can save their own developer-app
-- credentials ahead of the real OAuth/sync integration being built.
-- access_token/refresh_token/token_expires_at are included now so that
-- later work doesn't need a second migration just to add token storage.

create type public.integration_provider as enum ('whoop');

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider public.integration_provider not null,
  client_id text,
  client_secret text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table public.integration_connections enable row level security;

create policy "integration_connections_select_own"
  on public.integration_connections for select
  using (auth.uid() = user_id);

create policy "integration_connections_insert_own"
  on public.integration_connections for insert
  with check (auth.uid() = user_id);

create policy "integration_connections_update_own"
  on public.integration_connections for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "integration_connections_delete_own"
  on public.integration_connections for delete
  using (auth.uid() = user_id);

create trigger integration_connections_set_updated_at
  before update on public.integration_connections
  for each row execute function public.set_updated_at();
