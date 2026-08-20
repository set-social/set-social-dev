-- Coaching History, Phase 2 — see docs/coaching-history.md. Persists
-- generateWeeklyReview()'s result once per (user, week), closing
-- docs/ai-coaching.md's "weekly review has no multi-week trending" gap by
-- giving calculateReadinessTrend a cheap rolling-window read path instead
-- of reconstructing several past weeks' full engine inputs on every view.
--
-- Upsert-on-view, not write-once (contrast coaching_summaries, Phase 1,
-- which is write-once) — a week isn't final the moment it starts the way a
-- completed workout is final the moment it's saved. Every WeeklyReviewScreen
-- view (past or current week) recomputes via the engine and upserts on
-- (user_id, week_start); once a week is fully past, later views just
-- re-write the same values.

create table public.weekly_review_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  week_start date not null,
  summary jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index weekly_review_summaries_user_id_week_start_key
  on public.weekly_review_summaries (user_id, week_start);

alter table public.weekly_review_summaries enable row level security;

create policy "weekly_review_summaries_all_own"
  on public.weekly_review_summaries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
