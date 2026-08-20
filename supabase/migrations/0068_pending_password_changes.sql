-- Backs the "reset password in the app" flow (AccountScreen's Change
-- Password field): the athlete types a new password while already signed
-- in, but it isn't applied until they click the confirmation link emailed
-- to them from support@setsocial.app. See
-- supabase/functions/request-password-change (writes this table, sends the
-- email) and supabase/functions/confirm-password-change (reads it, applies
-- the password, deletes the row).
--
-- Deliberately holds the new password in plaintext for a short window —
-- there's no way to apply it via the admin API later without it. RLS below
-- denies every client-side role entirely; only the service-role key used by
-- the edge functions can touch this table.
create table public.pending_password_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  new_password text not null,
  -- sha-256 hex digest of the raw token mailed to the user — the raw token
  -- itself never touches the database, only this file's link does.
  token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- One live request per user — a fresh "Update Password" submission
-- supersedes whatever confirmation email was sent before it, so an old,
-- already-delivered email can't be used to apply a stale password.
create unique index pending_password_changes_user_id_key on public.pending_password_changes(user_id);
create unique index pending_password_changes_token_hash_key on public.pending_password_changes(token_hash);

alter table public.pending_password_changes enable row level security;
-- No policies are defined for anon/authenticated — RLS with zero policies
-- means every client-side query is denied by default. Only the
-- service-role key (which bypasses RLS entirely) can read or write this
-- table, and that key only ever lives in the two edge functions above.

-- Force-invalidates every active session for a user by deleting their rows
-- from auth.sessions (auth.refresh_tokens FKs to it ON DELETE CASCADE), so
-- confirm-password-change can make "you'll need to log back in" actually
-- true instead of leaving the athlete's existing session valid until it
-- naturally expires. This is the same workaround the wider Supabase
-- community uses in place of an official "log out this user everywhere"
-- admin API call — reaching into auth.sessions directly, guarded by
-- SECURITY DEFINER so only this function (not the caller) needs rights on
-- the auth schema. Revisit if Supabase ships a proper admin endpoint for
-- this.
create or replace function public.revoke_all_sessions(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from auth.sessions where user_id = target_user_id;
end;
$$;

revoke all on function public.revoke_all_sessions(uuid) from public;
grant execute on function public.revoke_all_sessions(uuid) to service_role;
