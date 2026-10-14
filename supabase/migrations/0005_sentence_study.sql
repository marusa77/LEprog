-- Add only sentence-specific study data. Original text, notes, updated_at,
-- vocabulary status/counts and vocabulary review schedules are left untouched.
begin;

alter table public.sentences
  add column if not exists review_preference text not null default 'normal'
    check (review_preference in ('less', 'normal', 'more')),
  add column if not exists last_reviewed_at timestamptz,
  add column if not exists sentence_review_count integer not null default 0
    check (sentence_review_count >= 0);

create table if not exists public.sentence_review_events (
  id uuid primary key,
  sentence_id uuid not null references public.sentences(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reviewed_at timestamptz not null default now()
);

create index if not exists sentence_review_events_user_date_idx
  on public.sentence_review_events(user_id, reviewed_at desc);

alter table public.sentence_review_events enable row level security;
-- Idempotent policy creation without dropping existing policies or data.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sentence_review_events' and policyname = 'Read own sentence reviews') then
    create policy "Read own sentence reviews" on public.sentence_review_events
      for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sentence_review_events' and policyname = 'Record own sentence reviews') then
    create policy "Record own sentence reviews" on public.sentence_review_events
      for insert to authenticated with check (
        auth.uid() = user_id and exists (
          select 1 from public.sentences s where s.id = sentence_id and s.user_id = auth.uid()
        )
      );
  end if;
end;
$$;

create or replace function public.record_sentence_review(p_sentence_id uuid, p_review_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_sentence public.sentences%rowtype;
  v_inserted_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_review_id is null then raise exception 'Review ID required'; end if;
  select * into v_sentence from public.sentences
    where id = p_sentence_id and user_id = v_user_id for update;
  if not found then raise exception 'Sentence not found'; end if;

  -- Retrying after a network failure does not count the same click twice.
  insert into public.sentence_review_events(id, sentence_id, user_id)
    values(p_review_id, p_sentence_id, v_user_id)
    on conflict (id) do nothing returning id into v_inserted_id;
  if v_inserted_id is not null then
    update public.sentences set
      last_reviewed_at = greatest(coalesce(last_reviewed_at, now()), now()),
      sentence_review_count = sentence_review_count + 1
      where id = p_sentence_id and user_id = v_user_id returning * into v_sentence;
  elsif not exists (select 1 from public.sentence_review_events
    where id = p_review_id and sentence_id = p_sentence_id and user_id = v_user_id) then
    raise exception 'Invalid review ID';
  end if;
  return jsonb_build_object('id', v_sentence.id,
    'review_preference', v_sentence.review_preference,
    'last_reviewed_at', v_sentence.last_reviewed_at,
    'sentence_review_count', v_sentence.sentence_review_count);
end;
$$;

revoke all on function public.record_sentence_review(uuid, uuid) from public;
grant execute on function public.record_sentence_review(uuid, uuid) to authenticated;
grant select, insert on public.sentence_review_events to authenticated;

commit;
notify pgrst, 'reload schema';
