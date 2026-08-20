-- Milestone 49: push_dispatch's setup step (0043's comment) was never
-- actually runnable on a hosted Supabase project. `alter database postgres
-- set app.settings.x = y` requires superuser or database-owner-with-
-- CREATEDB — Supabase deliberately doesn't grant real superuser to the
-- `postgres` role exposed in the SQL editor on hosted projects (shared,
-- multi-tenant Postgres fleet), so that statement always fails with
-- `42501: permission denied to set parameter`. This was never reachable,
-- on any environment, not just this one.
--
-- Supabase's supported mechanism for "a trigger function needs a secret" is
-- Vault (pgsodium-backed, pre-installed on every project) — its functions
-- are specifically granted to the `postgres` role for exactly this SQL
-- editor use case, unlike raw ALTER DATABASE. push_dispatch now reads both
-- values from vault.decrypted_secrets instead of current_setting(). Because
-- it's SECURITY DEFINER (0047), it reads them as its owner regardless of
-- who triggered it — the original client (an `authenticated` user sending a
-- friend request) never gets direct access to vault secrets themselves.
--
-- One-time setup, run once per environment from the SQL editor (replacing
-- 0043's now-dead alter database instructions):
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1', 'push_functions_url');
--   select vault.create_secret('<service role key>', 'push_service_role_key');
-- Until both exist, push_dispatch no-ops (same "no push yet, nothing else
-- breaks" behavior as before — see the null-guard below and 0048's
-- exception handler, kept as a second safety net).

create or replace function public.push_dispatch(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_functions_url text;
  v_service_role_key text;
begin
  select decrypted_secret into v_functions_url
    from vault.decrypted_secrets where name = 'push_functions_url';
  select decrypted_secret into v_service_role_key
    from vault.decrypted_secrets where name = 'push_service_role_key';

  if v_functions_url is null or v_service_role_key is null then
    return;
  end if;

  perform net.http_post(
    url := v_functions_url || '/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body := payload
  );
exception when others then
  null;
end;
$$;
