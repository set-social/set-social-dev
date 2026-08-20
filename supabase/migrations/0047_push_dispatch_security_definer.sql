-- Milestone 47: fix every friend-request insert (and, on the same code
-- path, every new DM message and friend-request accept) failing outright,
-- on both platforms, when the underlying row-write itself was completely
-- valid — including a private-profile request, which has no other reason to
-- fail.
--
-- friend_requests_push_after_insert (0043_push_notifications) is an AFTER
-- INSERT trigger that fires on every friend request, synchronously, inside
-- the same transaction as the client's own insert. It calls
-- public.push_dispatch(), which calls net.http_post() — but push_dispatch
-- was defined as a plain (non-SECURITY DEFINER) function, so it executes
-- with the *calling client's* privileges (the `authenticated` role via
-- PostgREST/RLS), not the function owner's. pg_net's functions are not
-- granted to `authenticated` by default, so that call raises a permission
-- error inside the trigger — which, being unhandled, propagates up and rolls
-- back the entire enclosing transaction. The client's insert then fails with
-- a generic error, even though the friend_requests row itself was perfectly
-- valid and RLS-compliant. This is unrelated to 0045/0046's fixes — every
-- fresh request has been broken since 0043 shipped, since the trigger fires
-- unconditionally on any 'pending' insert, private profile or not.
--
-- Compare 0036_profile_visibility's friend_requests_auto_accept_if_public,
-- which correctly used `security definer` for the same reason (it also
-- needs to read a column — is_private — the client itself isn't otherwise
-- granted to see).
--
-- Fixing push_dispatch itself (rather than each trigger that calls it)
-- covers every call site at once: the three immediate triggers in 0043 and
-- the batched-notification flush job in 0044.

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
end;
$$;
