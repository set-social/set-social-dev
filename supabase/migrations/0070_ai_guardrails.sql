-- Abuse/cost-control guardrails for edge functions that call Anthropic
-- (chat-coach today; form-check, generate-program, parse-checkin, and
-- classify-exercise-muscle can opt in the same way later - see
-- supabase/functions/_shared/aiGuardrails.ts).
--
-- One row per AI request attempt, whether it was allowed or blocked -
-- exactly the "row-per-event, count/sum the rows" pattern this codebase
-- already uses for the monthly free-tier checks (chat_messages,
-- form_check_results), just at a finer (hourly) grain and covering
-- rejections too, not only successful calls. Service-role only: nothing
-- here is ever meant to be read directly by the app, so RLS is enabled
-- with zero policies (blocks anon/authenticated entirely; the edge
-- functions' service-role client bypasses RLS as usual).

create table public.ai_request_log (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: an IP-rate-limited request is rejected before auth ever
  -- resolves a user, so there's no user_id to attach yet.
  user_id uuid references public.profiles (id) on delete set null,
  ip inet,
  endpoint text not null,
  allowed boolean not null default true,
  reason text not null default 'ok',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now()
);

create index ai_request_log_user_endpoint_created_idx on public.ai_request_log (user_id, endpoint, created_at);
create index ai_request_log_ip_created_idx on public.ai_request_log (ip, created_at);
create index ai_request_log_endpoint_created_idx on public.ai_request_log (endpoint, created_at);

alter table public.ai_request_log enable row level security;

-- Sums input_tokens + output_tokens since p_since, optionally scoped to one
-- user and/or one endpoint (both null = account-wide/global). A DB-side
-- aggregate rather than fetching rows and summing in the edge function -
-- the global-budget check runs this on every single AI request across
-- every user, so it needs to stay an index-backed sum, not a table scan
-- pulled over the wire.
create function public.ai_token_usage_since(
  p_since timestamptz,
  p_user_id uuid default null,
  p_endpoint text default null
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(input_tokens + output_tokens), 0)::bigint
  from public.ai_request_log
  where created_at >= p_since
    and (p_user_id is null or user_id = p_user_id)
    and (p_endpoint is null or endpoint = p_endpoint);
$$;

revoke execute on function public.ai_token_usage_since(timestamptz, uuid, text) from public, anon, authenticated;

-- Safety-net prune: this table is written on every AI request (allowed or
-- not), so unlike the monthly-cap tables it reads, it needs its own
-- retention policy. 35 days comfortably covers the daily/hourly windows
-- the guardrails actually query, plus enough history to review abuse
-- patterns over the past month.
create function public.prune_ai_request_log()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.ai_request_log where created_at < now() - interval '35 days';
end;
$$;

revoke execute on function public.prune_ai_request_log() from public, anon, authenticated;

select cron.schedule('prune-ai-request-log', '30 3 * * *', $$select public.prune_ai_request_log()$$);
