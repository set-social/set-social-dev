-- Milestone 71: Android push notifications, part 1 — push_tokens.platform was
-- locked to 'ios' only (0043_push_notifications.sql), since push was iOS/APNs
-- exclusive until now. Relax it to also allow 'android' (FCM); send-push
-- branches on this column to pick APNs vs FCM per token.

alter table public.push_tokens drop constraint if exists push_tokens_platform_check;
alter table public.push_tokens
  add constraint push_tokens_platform_check check (platform in ('ios', 'android'));

alter table public.push_tokens alter column platform drop default;
