-- Milestone 16: coaching memory — persisted, cross-week habit detection.
-- Detection itself is computed client-side (deterministic, stateless); this
-- table is the "memory" — it lets detected patterns survive across sessions
-- and lets the user permanently dismiss ones they don't want resurfaced.

create type public.training_pattern_type as enum (
  'inconsistent_weekday',
  'declining_consistency',
  'recurring_pain',
  'rpe_creep',
  'low_sleep_pattern'
);

create type public.training_pattern_status as enum ('active', 'dismissed', 'resolved');

create table public.training_patterns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  pattern_key text not null,
  pattern_type public.training_pattern_type not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  title text not null,
  detail text not null,
  evidence_summary text not null,
  status public.training_pattern_status not null default 'active',
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  dismissed_at timestamptz,
  unique (user_id, pattern_key)
);

create index training_patterns_user_id_idx on public.training_patterns (user_id);

alter table public.training_patterns enable row level security;

create policy "training_patterns_all_own" on public.training_patterns
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
