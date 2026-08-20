-- One-time 3-day free trial of SetSocial Pro for free accounts, offered from
-- the Paywall screen (any entry point — the welcome email's CTA is one of
-- several `trigger` values that land there, see PaywallScreen.tsx) and
-- activated only by an explicit in-app tap, never by the email link alone.
-- That distinction matters: email security scanners routinely "click" links
-- to prescan them before a real inbox ever sees the message, so granting the
-- trial straight off the soset://paywall deep link would burn almost every
-- athlete's one-time trial before they'd even opened their inbox.
--
-- Reuses the existing manual-grant machinery from 0050_premium_subscriptions.sql
-- wholesale (subscriptions row -> subscriptions_after_change trigger ->
-- sync_is_premium -> profiles.is_premium) rather than adding a parallel
-- "trial" concept: a trial IS a manual_grant, distinguished only by
-- plan = 'trial_3day', and it lapses via the exact same daily
-- expire_lapsed_subscriptions() sweep every other timed manual grant already
-- relies on — no separate expiry job needed. profiles.is_premium is what
-- every existing paywall/feature-gate check in the app already reads, so a
-- trial unlocks Pro everywhere for free, and un-unlocks it the same way when
-- it lapses.
--
-- "Don't show this again" once a trial has run its course without
-- converting to a paid subscription is enforced by never inserting a second
-- trial_3day row for the same user (checked below) — the client's own
-- eligibility check (useHasUsedTrial, purchases.ts) just reads whether that
-- row exists, active or not.
--
-- Keep TRIAL in sync by hand with TRIAL_DAYS in
-- supabase/functions/send-welcome-email/index.ts if this ever changes — nothing
-- shares that constant between SQL and the Edge Function.

create function public.start_free_trial()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_premium boolean;
  v_already_used boolean;
  v_expires_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select is_premium into v_is_premium from public.profiles where id = v_user_id;
  if coalesce(v_is_premium, false) then
    return jsonb_build_object('granted', false, 'reason', 'already_premium');
  end if;

  select exists (
    select 1 from public.subscriptions
    where user_id = v_user_id and plan = 'trial_3day'
  ) into v_already_used;
  if v_already_used then
    return jsonb_build_object('granted', false, 'reason', 'already_used');
  end if;

  v_expires_at := now() + interval '3 days';
  insert into public.subscriptions (user_id, source, status, plan, expires_at, note)
  values (v_user_id, 'manual_grant', 'active', 'trial_3day', v_expires_at, 'Free trial started in-app');

  return jsonb_build_object('granted', true, 'expires_at', v_expires_at);
end;
$$;

-- Safe to expose directly to signed-in clients (unlike admin_grant_premium,
-- which takes an arbitrary p_user_id and stays SQL-editor-only) — this one
-- always acts on auth.uid() and enforces its own one-per-account limit
-- server-side, so there's no way to grant a trial to anyone but yourself or
-- to get a second one.
grant execute on function public.start_free_trial() to authenticated;
