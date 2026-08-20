-- Milestone 46: fix "Add Friend" failing with a row-level-security error
-- whenever the addressee's profile is public.
--
-- friend_requests_insert_own (0036_profile_visibility) requires
-- `status = 'pending'` on insert — added specifically so a client can't
-- insert an already-'accepted' row directly, bypassing the addressee's
-- consent. But 0036 also added friend_requests_auto_accept_if_public, a
-- BEFORE INSERT trigger that flips a pending insert straight to 'accepted'
-- when the addressee's profile is public. Postgres evaluates a policy's
-- WITH CHECK against the row *after* BEFORE ROW triggers have run — so the
-- trigger's own promotion to 'accepted' then fails the insert policy's own
-- `status = 'pending'` check, and the whole insert is rejected with a
-- generic RLS violation. Every request to a public profile has been broken
-- since 0036 shipped, on every platform (this is entirely server-side).
--
-- Fix: widen the check to also allow `status = 'accepted'`, but only when
-- it's independently, server-side verifiable as legitimate — the exact same
-- condition the trigger itself uses (the addressee's real is_private
-- column, not anything client-supplied). A client still cannot force
-- 'accepted' for a private addressee: neither the trigger promotes it nor
-- this check allows it, so the original consent guarantee is unchanged.

drop policy "friend_requests_insert_own" on public.friend_requests;

create policy "friend_requests_insert_own" on public.friend_requests
  for insert with check (
    auth.uid() = requester_id
    and (
      status = 'pending'
      or (
        status = 'accepted'
        and not (select is_private from public.profiles where id = addressee_id)
      )
    )
  );
