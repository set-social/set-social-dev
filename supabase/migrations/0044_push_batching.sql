-- Milestone 44: push notifications, part 2 — Photo Like and Photo Comment,
-- the two batched types from the reviewed design spec. Unlike the immediate
-- triggers in 0043, these hold delivery open for a short window (10 minutes
-- for likes, 60 seconds for comments) so a burst of activity on one post
-- collapses into a single grouped push instead of one per event.
--
-- One pending row per (kind, post_id) at a time, enforced by a partial
-- unique index — a like/comment during an already-open window is absorbed
-- into it for free (send-push recomputes the current aggregate at flush
-- time, so the row itself only needs to remember *that* a batch is due, not
-- *what's* in it). A pg_cron job sweeps every minute for windows that have
-- closed and flushes them.

create extension if not exists pg_cron with schema cron;

create table public.push_batch_queue (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('post_like', 'post_comment')),
  post_id uuid not null references public.posts (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  window_start timestamptz not null default now(),
  sent_at timestamptz
);

-- Partial (not plain) unique: a post can accumulate many *sent* batches
-- over its lifetime, but only ever one *open* one at a time.
create unique index push_batch_queue_open_idx
  on public.push_batch_queue (kind, post_id)
  where sent_at is null;

create index push_batch_queue_due_idx
  on public.push_batch_queue (sent_at, window_start)
  where sent_at is null;

create function public.push_batch_enqueue(p_kind text, p_post_id uuid, p_actor_id uuid)
returns void
language plpgsql
as $$
declare
  v_owner_id uuid;
begin
  select user_id into v_owner_id from public.posts where id = p_post_id;

  -- No push for liking/commenting on your own post.
  if v_owner_id is null or v_owner_id = p_actor_id then
    return;
  end if;

  insert into public.push_batch_queue (kind, post_id, owner_id)
  values (p_kind, p_post_id, v_owner_id)
  on conflict (kind, post_id) where sent_at is null do nothing;
end;
$$;

create function public.post_likes_push_enqueue()
returns trigger
language plpgsql
as $$
begin
  perform public.push_batch_enqueue('post_like', new.post_id, new.user_id);
  return new;
end;
$$;

create trigger post_likes_push_after_insert
  after insert on public.post_likes
  for each row execute function public.post_likes_push_enqueue();

create function public.post_comments_push_enqueue()
returns trigger
language plpgsql
as $$
begin
  perform public.push_batch_enqueue('post_comment', new.post_id, new.user_id);
  return new;
end;
$$;

create trigger post_comments_push_after_insert
  after insert on public.post_comments
  for each row execute function public.post_comments_push_enqueue();

-- Runs every minute; each due row is dispatched then deleted outright
-- (rather than marked sent and left behind) so the queue only ever holds
-- what's currently open — nothing here needs a history of past batches.
create function public.push_flush_due_batches()
returns void
language plpgsql
as $$
declare
  r record;
  v_window interval;
begin
  for r in
    select * from public.push_batch_queue
    where sent_at is null
      and window_start <= now() - case kind
        when 'post_like' then interval '10 minutes'
        else interval '60 seconds'
      end
  loop
    perform public.push_dispatch(
      jsonb_build_object('type', r.kind, 'post_id', r.post_id, 'owner_id', r.owner_id, 'window_start', r.window_start)
    );
    delete from public.push_batch_queue where id = r.id;
  end loop;
end;
$$;

select cron.schedule('push-flush-due-batches', '* * * * *', $$select public.push_flush_due_batches()$$);
