-- Milestone 45: fix "Add Friend" silently failing to re-request someone
-- whose earlier request was declined.
--
-- friend_requests_delete_participant lets either side delete a row, but
-- decline (friend_requests_update_addressee) only ever flips status to
-- 'declined' — it never deletes. That row then sits there forever holding
-- the unique(requester_id, addressee_id) key. resolveFriendRequestState()
-- (community.ts) doesn't surface 'declined' as a state, so the button shows
-- "Add Friend" again as if nothing happened — but the client's plain INSERT
-- on click violates that unique constraint and throws, and nothing was
-- listening for the error, so the tap looked like a no-op.
--
-- Fix: let the original requester revive their own declined row back to
-- 'pending' (an UPDATE, not a second INSERT) instead of colliding with the
-- unique constraint. Deliberately leaves friend_requests_auto_accept_if_public
-- as BEFORE INSERT only (unchanged) — its interaction with an UPDATE's WITH
-- CHECK isn't one we can verify without a live database, and it isn't needed
-- here: a revived request landing back in 'pending' for the addressee to
-- approve is still correct, just not instant, if their profile turned public
-- in the meantime.

create policy "friend_requests_requester_resend" on public.friend_requests
  for update using (auth.uid() = requester_id and status = 'declined')
  with check (auth.uid() = requester_id and status = 'pending');
