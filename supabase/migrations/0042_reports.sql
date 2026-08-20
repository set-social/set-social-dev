-- Milestone 42: user reports, for Apple Guideline 1.2 (Safety — User
-- Generated Content). Insert-only from the client — nobody but the
-- reporter's own row is readable back; review happens outside the app via
-- the Supabase dashboard (or the webhook noted in the compliance brief),
-- not through a client-facing moderation queue.

create type public.report_reason as enum (
  'spam',
  'harassment',
  'nudity_or_sexual_content',
  'violence_or_dangerous_behavior',
  'impersonation',
  'false_information',
  'other'
);

create type public.report_target as enum ('post', 'comment', 'message', 'conversation', 'profile');

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reported_user_id uuid not null references public.profiles (id) on delete cascade,
  target_type public.report_target not null,
  target_id uuid not null,
  reason public.report_reason not null,
  details text,
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;

create policy "reports_insert_own"
  on public.reports for insert
  with check (auth.uid() = reporter_id);

-- No select/update policy for clients — reports are write-only from the
-- app's perspective, same posture as the danger-zone delete-account flow.
