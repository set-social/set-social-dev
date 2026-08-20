-- Milestone 63: photo-based food logging via AI Coach chat, phase 2 of the
-- energy-balance feature. Coach identifies a food photo and proposes an
-- estimate via the new log_food_estimate tool (see chat-coach), inserted as
-- status='pending' so it never counts toward the athlete's daily totals
-- until they confirm or edit it in the app — the same "no silent auto-log"
-- rule the Home energy card already follows. Phase 1's manual entries
-- (LogFoodScreen) are unaffected — status defaults 'confirmed', matching
-- that the athlete already reviewed the numbers before saving.
--
-- chat_messages grows a nullable photo_path and a nullable FK to the
-- resulting food_log_entries row rather than a jsonb blob — same shape
-- dm_messages already uses for a structured (non-text) chat attachment via
-- workout_share_id (0061_workout_shares.sql), reused here instead of
-- inventing a second convention.

create type public.food_log_status as enum ('pending', 'confirmed');
create type public.food_log_confidence as enum ('high', 'medium', 'low');

alter table public.food_log_entries add column status public.food_log_status not null default 'confirmed';
alter table public.food_log_entries add column confidence public.food_log_confidence;
alter table public.food_log_entries add column photo_path text;

alter table public.chat_messages alter column content drop not null;
alter table public.chat_messages add column photo_path text;
alter table public.chat_messages
  add column food_log_entry_id uuid references public.food_log_entries (id) on delete set null;

alter table public.chat_messages add constraint chat_messages_has_content
  check (content is not null or photo_path is not null or food_log_entry_id is not null);

-- Private bucket, owner-only — chat photos are never shared, so this skips
-- the friends-select policy post-photos needs (0019_posts.sql).
insert into storage.buckets (id, name, public)
values ('chat-photos', 'chat-photos', false)
on conflict (id) do nothing;

create policy "chat_photos_owner_all" on storage.objects
  for all
  using (bucket_id = 'chat-photos' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'chat-photos' and auth.uid()::text = (storage.foldername(name))[1]);
