-- Milestone 6: body metrics (weight tracking) for progress analytics.

create table public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  logged_at date not null default current_date,
  weight_kg numeric(6, 2) not null,
  notes text,
  created_at timestamptz not null default now(),
  unique (user_id, logged_at)
);

create index body_metrics_user_id_idx on public.body_metrics (user_id);

alter table public.body_metrics enable row level security;

create policy "body_metrics_all_own"
  on public.body_metrics for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
