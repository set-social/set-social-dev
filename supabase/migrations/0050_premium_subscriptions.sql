-- Milestone 50: SetSocial Premium ($6.99/mo) — the subscriptions table
-- (source of truth + audit trail for both real purchases and manual
-- grants), a denormalized profiles.is_premium for cheap reads everywhere a
-- profile is already fetched (feed, leaderboard, search, useProfile), and
-- an admin lever for manually granting/revoking Premium — e.g. beta tester
-- thank-yous — without an admin panel: call these two functions directly
-- from the SQL editor.
--
--   select public.admin_grant_premium('<user-uuid>', 'beta tester thank-you', now() + interval '3 months');
--   select public.admin_grant_premium('<user-uuid>', 'beta tester thank-you');  -- no expiry
--   select public.admin_revoke_premium('<user-uuid>');
--
-- Real purchases land here too, once wired up: a RevenueCat webhook handler
-- (a future Edge Function, using the service_role key — bypasses RLS same
-- as push_dispatch) inserts/updates rows with source = 'revenuecat'.

create type public.subscription_source as enum ('revenuecat', 'manual_grant');
create type public.subscription_status as enum ('active', 'canceled', 'expired');

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  source public.subscription_source not null,
  status public.subscription_status not null default 'active',
  plan text not null default 'premium_monthly',
  started_at timestamptz not null default now(),
  -- null = doesn't lapse on its own (still ends via cancellation or a
  -- RevenueCat webhook flipping status directly) — used for manual grants
  -- with no fixed end date.
  expires_at timestamptz,
  -- Cross-reference for the future webhook handler to find "the" row for a
  -- given RevenueCat customer; unused by manual grants.
  revenuecat_customer_id text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_user_id_idx on public.subscriptions (user_id);

alter table public.subscriptions enable row level security;

-- Read-only for the owner (Settings shows "Premium — active, renews...").
-- Deliberately no insert/update/delete policy for `authenticated` at all —
-- every write goes through the SECURITY DEFINER functions below, or the
-- future webhook handler (service_role, bypasses RLS entirely). A client
-- must never be able to insert their own 'active' row here.
create policy "subscriptions_select_own" on public.subscriptions
  for select using (auth.uid() = user_id);

-- Denormalized onto profiles so every screen that already fetches a
-- profile gets entitlement status for free, no extra join or query.
-- Correctness is owned entirely by sync_is_premium() below, never by a
-- client write — profiles_update_own (0001_profiles.sql) already lets an
-- athlete update their own row for other fields, so this column is
-- explicitly walled off from that policy at the column-privilege level
-- (independent of and in addition to row-level security): without this,
-- any signed-in client could call
-- `supabase.from('profiles').update({ is_premium: true })` on their own
-- row and grant themselves free Premium.
alter table public.profiles add column is_premium boolean not null default false;
revoke update (is_premium) on public.profiles from authenticated;

create function public.sync_is_premium(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set is_premium = exists (
    select 1 from public.subscriptions
    where user_id = p_user_id
      and status = 'active'
      and (expires_at is null or expires_at > now())
  )
  where id = p_user_id;
end;
$$;

create function public.subscriptions_sync_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_is_premium(coalesce(new.user_id, old.user_id));
  return coalesce(new, old);
end;
$$;

create trigger subscriptions_after_change
  after insert or update or delete on public.subscriptions
  for each row execute function public.subscriptions_sync_trigger();

create function public.admin_grant_premium(p_user_id uuid, p_note text default null, p_expires_at timestamptz default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (user_id, source, status, plan, expires_at, note)
  values (p_user_id, 'manual_grant', 'active', 'premium_monthly', p_expires_at, p_note);
end;
$$;

-- Only cancels manual grants — a real subscription should be canceled
-- through RevenueCat/the store, not from here, so this deliberately can't
-- touch source = 'revenuecat' rows.
create function public.admin_revoke_premium(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.subscriptions
  set status = 'canceled', updated_at = now()
  where user_id = p_user_id and status = 'active' and source = 'manual_grant';
end;
$$;

-- Every function above is meant to be called from the SQL editor (running
-- as postgres) or a future internal admin tool — never by a client. Revoke
-- explicitly: otherwise Postgres's default EXECUTE-granted-to-PUBLIC on new
-- functions would let any authenticated user call
-- supabase.rpc('admin_grant_premium', { p_user_id: '<their own id>' }) and
-- grant themselves free Premium.
revoke execute on function public.admin_grant_premium(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_revoke_premium(uuid) from public, anon, authenticated;
revoke execute on function public.sync_is_premium(uuid) from public, anon, authenticated;

-- Daily sweep for manual grants whose expires_at has passed with no other
-- event to trigger a re-sync — a real RevenueCat subscription instead gets
-- an explicit EXPIRATION webhook that updates its row directly, so this is
-- only load-bearing for the manual-grant path (e.g. a beta-tester window
-- lapsing with nobody manually revoking it).
create function public.expire_lapsed_subscriptions()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.subscriptions
  set status = 'expired', updated_at = now()
  where status = 'active' and expires_at is not null and expires_at <= now();
end;
$$;

revoke execute on function public.expire_lapsed_subscriptions() from public, anon, authenticated;

select cron.schedule('expire-lapsed-subscriptions', '0 3 * * *', $$select public.expire_lapsed_subscriptions()$$);

-- Extend public_profiles (0036_profile_visibility.sql) so the Premium badge
-- can render anywhere a profile card already does — feed, leaderboard,
-- search results, friend profile — without a separate query.
drop view if exists public.public_profiles cascade;

create view public.public_profiles
  with (security_invoker = false) as
  select id, display_name, avatar_url, bio, hide_stats_from_friends, hide_photos_from_friends, handle, is_private, is_premium
  from public.profiles;

grant select on public.public_profiles to authenticated;
