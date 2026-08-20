-- Milestone 48: push_dispatch can still break the write that triggered it —
-- 0047 fixed the permission error, but exposed the next one: the two
-- database settings push_dispatch depends on
-- (app.settings.supabase_functions_url / app.settings.service_role_key)
-- were never actually set on this project (0043's comment says this is a
-- one-time manual step; it was never run). With the URL setting missing,
-- current_setting(..., true) returns null, and `null || '/send-push'` is
-- null in SQL — so net.http_post's own url column gets a null, which
-- net.http_request_queue rejects with a hard NOT NULL violation. That
-- exception is unhandled, so it propagates out of the trigger and rolls
-- back the caller's insert, exactly like the permission error 0047 fixed.
--
-- 0043's design comment says push failures should be invisible to the
-- caller ("a slow or failing push never holds up the write that triggered
-- it") — pg_net's own async dispatch honors that for failures *after* the
-- request is queued, but never covered failures *queuing* the request in
-- the first place, whether that's this missing-config case or anything
-- else. Catch everything here instead of trying to anticipate every way
-- push_dispatch could fail — a fire-and-forget side effect must never be
-- able to fail the transaction it's attached to.
--
-- The missing settings should still be configured (see 0043's comment) —
-- this makes not having done that a "no push notifications yet" gap
-- instead of a "every friend request/message errors out" outage.

create or replace function public.push_dispatch(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := current_setting('app.settings.supabase_functions_url', true) || '/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := payload
  );
exception when others then
  null;
end;
$$;
