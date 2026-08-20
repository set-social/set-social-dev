-- Share a workout (or a whole Sun-Sat week) with another user via DM.
--
-- workout_templates/program_exercises/scheduled_workout_exercises are all
-- owner-only RLS, and even the shared `exercises` catalog hides custom
-- (non-stock) rows from everyone but their creator — so the recipient
-- literally cannot read the sender's live workout data. A share is
-- therefore a self-contained denormalized snapshot (`payload`), captured
-- at share-time, not a live reference back to the sender's rows.

create type public.workout_share_type as enum ('single_workout', 'weekly_plan');
create type public.workout_share_status as enum ('pending', 'accepted', 'declined');

create table public.workout_shares (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  share_type public.workout_share_type not null,
  title text not null,
  payload jsonb not null,
  status public.workout_share_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint workout_shares_no_self_share check (sender_id <> recipient_id)
);

create index workout_shares_sender_id_idx on public.workout_shares (sender_id);
create index workout_shares_recipient_id_idx on public.workout_shares (recipient_id);

alter table public.workout_shares enable row level security;

create policy "workout_shares_select_participant" on public.workout_shares
  for select using (auth.uid() = sender_id or auth.uid() = recipient_id);

-- No blocked_users check duplicated here (unlike dm_conversations' insert
-- policy) — actual delivery is already gated by dm_messages_insert_participant
-- below; a dangling, never-attached workout_shares row is harmless, the same
-- way an unmessaged dm_conversations row already can exist.
create policy "workout_shares_insert_sender" on public.workout_shares
  for insert with check (auth.uid() = sender_id);

-- Only the recipient can accept/decline. Unlike dm_conversations' hidden_for_*
-- flags, a plain RLS update policy is safe here (no SECURITY DEFINER needed):
-- the accept-time payload only ever gets written into the accepting
-- recipient's OWN templates/schedule, so a recipient tampering with their
-- own row before accepting only self-sabotages their own created rows.
create policy "workout_shares_update_recipient" on public.workout_shares
  for update using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);

alter table public.dm_messages
  add column workout_share_id uuid references public.workout_shares (id) on delete set null;

alter table public.dm_messages drop constraint dm_messages_has_content;
alter table public.dm_messages add constraint dm_messages_has_content
  check (body is not null or photo_path is not null or workout_share_id is not null);
