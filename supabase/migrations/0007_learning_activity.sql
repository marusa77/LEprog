-- Record learning metadata only. Never rewrite learning content or review schedules.
-- Apply after 0001-0006. Safe to rerun: historical events and triggers are deduplicated.
begin;

create table if not exists public.learning_activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('save', 'review', 'lookup')),
  source text not null check (source in ('sentence', 'vocabulary', 'knowledge', 'phrase', 'translation')),
  subject_key text not null check (char_length(subject_key) between 1 and 80),
  occurred_at timestamptz not null default now(),
  study_date date not null,
  check ((kind = 'lookup' and source = 'translation' and subject_key = 'daily') or
    (kind = 'save' and source in ('sentence', 'vocabulary', 'knowledge', 'phrase')) or
    (kind = 'review' and source in ('sentence', 'vocabulary', 'knowledge'))),
  unique (user_id, study_date, kind, source, subject_key)
);
create index if not exists learning_activity_user_time_idx on public.learning_activity_events(user_id, occurred_at, id);
alter table public.learning_activity_events enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='learning_activity_events' and policyname='Read own learning activity') then
    create policy "Read own learning activity" on public.learning_activity_events
      for select to authenticated using (auth.uid() = user_id);
  end if;
end; $$;
revoke all on public.learning_activity_events from public, anon, authenticated;
grant select on public.learning_activity_events to authenticated;

-- Internal writer. Only trusted triggers/RPCs below can invoke it.
create or replace function public.append_learning_activity(p_user_id uuid, p_kind text, p_source text, p_key text, p_time timestamptz)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.learning_activity_events(user_id, kind, source, subject_key, occurred_at, study_date)
  values(p_user_id, p_kind, p_source, p_key, p_time, (p_time at time zone 'Asia/Tokyo')::date)
  on conflict (user_id, study_date, kind, source, subject_key) do nothing;
$$;
revoke all on function public.append_learning_activity(uuid,text,text,text,timestamptz) from public, anon, authenticated;

create or replace function public.capture_learning_activity()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_source text; v_key text; v_kind text := 'save'; v_time timestamptz := now();
begin
  -- Admin maintenance, including installing SQL, is not a user's study action.
  if auth.uid() is null or auth.uid() <> new.user_id then return new; end if;
  if tg_table_name = 'sentences' then
    v_source := 'sentence'; v_key := new.id::text;
    if tg_op = 'UPDATE' then
      if (new.original_text, new.translation, new.note) is not distinct from (old.original_text, old.translation, old.note) then return new; end if;
    end if;
  elsif tg_table_name = 'vocabulary_items' then
    v_source := 'vocabulary'; v_key := new.id::text;
    if tg_op = 'UPDATE' then
      if (new.term, new.meaning, new.core_image, new.note, new.occurrence_count) is not distinct from
         (old.term, old.meaning, old.core_image, old.note, old.occurrence_count) then return new; end if;
    end if;
  elsif tg_table_name = 'custom_phrase_patterns' then
    v_source := 'phrase'; v_key := new.id::text;
    if tg_op = 'UPDATE' then
      if (new.term, new.meaning) is not distinct from (old.term, old.meaning) then return new; end if;
    end if;
  elsif tg_table_name = 'knowledge_notes' then
    v_source := 'knowledge'; v_key := new.id::text;
    if tg_op = 'UPDATE' then
      if (new.title, new.body) is not distinct from (old.title, old.body) then return new; end if;
    end if;
  elsif tg_table_name = 'review_logs' then
    v_source := 'vocabulary'; v_key := new.vocabulary_id::text; v_kind := 'review'; v_time := new.reviewed_at;
  elsif tg_table_name = 'sentence_review_events' then
    v_source := 'sentence'; v_key := new.sentence_id::text; v_kind := 'review'; v_time := new.reviewed_at;
  else return new;
  end if;
  perform public.append_learning_activity(new.user_id, v_kind, v_source, v_key, v_time);
  return new;
end; $$;
revoke all on function public.capture_learning_activity() from public, anon, authenticated;

do $$ declare v_table text; begin
  foreach v_table in array array['sentences','vocabulary_items','knowledge_notes','custom_phrase_patterns'] loop
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || v_table)::regclass and tgname = 'capture_learning_activity') then
      execute format('create trigger capture_learning_activity after insert or update on public.%I for each row execute function public.capture_learning_activity()', v_table);
    end if;
  end loop;
  foreach v_table in array array['review_logs','sentence_review_events'] loop
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || v_table)::regclass and tgname = 'capture_learning_activity') then
      execute format('create trigger capture_learning_activity after insert on public.%I for each row execute function public.capture_learning_activity()', v_table);
    end if;
  end loop;
end; $$;

-- Explicit rereading outside the scheduled review UI does not alter SRS/status.
create or replace function public.record_learning_review(p_source text, p_subject_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_owned boolean := false;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_source = 'knowledge' then
    select exists(select 1 from public.knowledge_notes where id=p_subject_id and user_id=v_user) into v_owned;
  elsif p_source = 'vocabulary' then
    select exists(select 1 from public.vocabulary_items where id=p_subject_id and user_id=v_user) into v_owned;
  elsif p_source = 'sentence' then
    select exists(select 1 from public.sentences where id=p_subject_id and user_id=v_user) into v_owned;
  end if;
  if not v_owned then raise exception 'Learning item not found or not allowed'; end if;
  perform public.append_learning_activity(v_user, 'review', p_source, p_subject_id::text, now());
end; $$;
revoke all on function public.record_learning_review(text,uuid) from public, anon;
grant execute on function public.record_learning_review(text,uuid) to authenticated;

-- One lookup day, not one event per automatically translated candidate word.
-- No English text, translation, URL or AI prompt is stored in the activity log.
create or replace function public.record_learning_lookup()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  perform public.append_learning_activity(v_user, 'lookup', 'translation', 'daily', now());
end; $$;
revoke all on function public.record_learning_lookup() from public, anon;
grant execute on function public.record_learning_lookup() to authenticated;

-- Restore only dates supported by actual history. Past edits and passive views
-- have no historical log; do not invent dates from updated_at or review totals.
insert into public.learning_activity_events(user_id,kind,source,subject_key,occurred_at,study_date)
select user_id,'save','sentence',id::text,created_at,(created_at at time zone 'Asia/Tokyo')::date from public.sentences
union all select user_id,'save','vocabulary',id::text,created_at,(created_at at time zone 'Asia/Tokyo')::date from public.vocabulary_items
union all select user_id,'save','vocabulary',vocabulary_id::text,created_at,(created_at at time zone 'Asia/Tokyo')::date from public.sentence_vocabulary
union all select user_id,'save','knowledge',id::text,created_at,(created_at at time zone 'Asia/Tokyo')::date from public.knowledge_notes
union all select user_id,'save','phrase',id::text,created_at,(created_at at time zone 'Asia/Tokyo')::date from public.custom_phrase_patterns
union all select user_id,'review','vocabulary',vocabulary_id::text,reviewed_at,(reviewed_at at time zone 'Asia/Tokyo')::date from public.review_logs
union all select user_id,'review','sentence',sentence_id::text,reviewed_at,(reviewed_at at time zone 'Asia/Tokyo')::date from public.sentence_review_events where true
on conflict (user_id,study_date,kind,source,subject_key) do nothing;

commit;
notify pgrst, 'reload schema';
