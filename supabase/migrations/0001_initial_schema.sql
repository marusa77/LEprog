create extension if not exists pgcrypto;

create table public.sentences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  original_text text not null,
  machine_translation text,
  translation text not null default '',
  note text not null default '',
  source_url text,
  source_title text,
  subreddit text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vocabulary_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  term text not null,
  normalized_term text not null,
  base_form text,
  meaning text not null default '',
  note text not null default '',
  status text not null default 'unlearned' check (status in ('unlearned','learning','mastered')),
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  priority_score integer not null default 1 check (priority_score >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  next_review_at timestamptz not null default now(),
  review_interval_days integer not null default 0,
  correct_streak integer not null default 0,
  lapse_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, normalized_term)
);

create table public.sentence_vocabulary (
  sentence_id uuid not null references public.sentences(id) on delete cascade,
  vocabulary_id uuid not null references public.vocabulary_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  selected_text text not null,
  created_at timestamptz not null default now(),
  primary key (sentence_id, vocabulary_id)
);

create table public.review_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  vocabulary_id uuid not null references public.vocabulary_items(id) on delete cascade,
  result text not null check (result in ('forgot','uncertain','remembered')),
  next_review_at timestamptz not null,
  reviewed_at timestamptz not null default now()
);

create table public.monthly_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null,
  cloud_translation_characters integer not null default 0,
  ai_requests integer not null default 0,
  ai_estimated_usd numeric(10,4) not null default 0,
  primary key (user_id, month)
);

create index sentences_user_created_idx on public.sentences(user_id, created_at desc);
create index vocabulary_user_review_idx on public.vocabulary_items(user_id, next_review_at);
create index review_logs_user_reviewed_idx on public.review_logs(user_id, reviewed_at desc);

alter table public.sentences enable row level security;
alter table public.vocabulary_items enable row level security;
alter table public.sentence_vocabulary enable row level security;
alter table public.review_logs enable row level security;
alter table public.monthly_usage enable row level security;

create policy "Users manage their sentences" on public.sentences for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage their vocabulary" on public.vocabulary_items for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage their sentence links" on public.sentence_vocabulary for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage their reviews" on public.review_logs for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users read their usage" on public.monthly_usage for select to authenticated using (auth.uid() = user_id);

create or replace function public.save_capture(
  p_original_text text,
  p_machine_translation text,
  p_translation text,
  p_note text,
  p_source_url text,
  p_source_title text,
  p_subreddit text,
  p_terms jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_sentence_id uuid;
  v_term jsonb;
  v_vocabulary_id uuid;
  v_was_existing boolean;
  v_results jsonb := '[]'::jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_original_text), '') is null then raise exception 'Original text is required'; end if;

  insert into public.sentences(user_id, original_text, machine_translation, translation, note, source_url, source_title, subreddit)
  values(v_user_id, trim(p_original_text), p_machine_translation, coalesce(p_translation,''), coalesce(p_note,''), p_source_url, p_source_title, p_subreddit)
  returning id into v_sentence_id;

  for v_term in select * from jsonb_array_elements(coalesce(p_terms, '[]'::jsonb)) loop
    select id into v_vocabulary_id from public.vocabulary_items
    where user_id = v_user_id and normalized_term = lower(regexp_replace(trim(v_term->>'term'), '\s+', ' ', 'g'));
    v_was_existing := v_vocabulary_id is not null;

    if v_was_existing then
      update public.vocabulary_items set
        occurrence_count = occurrence_count + 1,
        priority_score = priority_score + 1,
        last_seen_at = now(),
        meaning = case when nullif(meaning,'') is null then coalesce(v_term->>'meaning','') else meaning end,
        updated_at = now()
      where id = v_vocabulary_id;
    else
      insert into public.vocabulary_items(user_id, term, normalized_term, meaning, note)
      values(v_user_id, trim(v_term->>'term'), lower(regexp_replace(trim(v_term->>'term'), '\s+', ' ', 'g')), coalesce(v_term->>'meaning',''), coalesce(v_term->>'note',''))
      returning id into v_vocabulary_id;
    end if;

    insert into public.sentence_vocabulary(sentence_id, vocabulary_id, user_id, selected_text)
    values(v_sentence_id, v_vocabulary_id, v_user_id, trim(v_term->>'term')) on conflict do nothing;
    v_results := v_results || jsonb_build_array(jsonb_build_object('id', v_vocabulary_id, 'term', v_term->>'term', 'existing', v_was_existing));
  end loop;

  return jsonb_build_object('sentence_id', v_sentence_id, 'terms', v_results);
end;
$$;

create or replace function public.record_review(p_vocabulary_id uuid, p_result text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_item public.vocabulary_items%rowtype;
  v_interval integer;
  v_next timestamptz;
  v_status text;
  v_streak integer;
begin
  if p_result not in ('forgot','uncertain','remembered') then raise exception 'Invalid result'; end if;
  select * into v_item from public.vocabulary_items where id = p_vocabulary_id and user_id = v_user_id for update;
  if not found then raise exception 'Vocabulary item not found'; end if;
  if p_result = 'forgot' then v_interval := 1; v_streak := 0; v_status := 'learning';
  elsif p_result = 'uncertain' then v_interval := 3; v_streak := v_item.correct_streak; v_status := 'learning';
  else v_interval := case when v_item.review_interval_days < 1 then 7 else least(v_item.review_interval_days * 2, 60) end; v_streak := v_item.correct_streak + 1; v_status := case when v_streak >= 3 then 'mastered' else 'learning' end;
  end if;
  v_next := now() + make_interval(days => v_interval);
  update public.vocabulary_items set status=v_status, next_review_at=v_next, review_interval_days=v_interval, correct_streak=v_streak, lapse_count=lapse_count + case when p_result='forgot' then 1 else 0 end, updated_at=now() where id=p_vocabulary_id;
  insert into public.review_logs(user_id,vocabulary_id,result,next_review_at) values(v_user_id,p_vocabulary_id,p_result,v_next);
  return jsonb_build_object('status',v_status,'next_review_at',v_next,'interval_days',v_interval);
end;
$$;

create or replace function public.reserve_cloud_translation(p_characters integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_user_id uuid := auth.uid(); v_month date := date_trunc('month', now())::date; v_total integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_characters < 1 or p_characters > 5000 then raise exception 'Invalid character count'; end if;
  insert into public.monthly_usage(user_id, month, cloud_translation_characters)
  values(v_user_id, v_month, p_characters)
  on conflict(user_id, month) do update set cloud_translation_characters = monthly_usage.cloud_translation_characters + excluded.cloud_translation_characters
  returning cloud_translation_characters into v_total;
  if v_total > 450000 then
    update public.monthly_usage set cloud_translation_characters = cloud_translation_characters - p_characters where user_id=v_user_id and month=v_month;
    raise exception 'Monthly cloud translation limit reached';
  end if;
  return v_total;
end;
$$;

create or replace function public.reserve_ai_request(p_estimated_usd numeric default 0.001)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_user_id uuid := auth.uid(); v_month date := date_trunc('month', now())::date; v_total numeric;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_estimated_usd <= 0 or p_estimated_usd > 0.05 then raise exception 'Invalid estimate'; end if;
  insert into public.monthly_usage(user_id, month, ai_requests, ai_estimated_usd)
  values(v_user_id, v_month, 1, p_estimated_usd)
  on conflict(user_id, month) do update set ai_requests = monthly_usage.ai_requests + 1, ai_estimated_usd = monthly_usage.ai_estimated_usd + excluded.ai_estimated_usd
  returning ai_estimated_usd into v_total;
  if v_total > 1 then
    update public.monthly_usage set ai_requests=ai_requests-1, ai_estimated_usd=ai_estimated_usd-p_estimated_usd where user_id=v_user_id and month=v_month;
    raise exception 'Monthly AI budget reached';
  end if;
  return v_total;
end;
$$;

grant execute on function public.save_capture(text,text,text,text,text,text,text,jsonb) to authenticated;
grant execute on function public.record_review(uuid,text) to authenticated;
grant execute on function public.reserve_cloud_translation(integer) to authenticated;
grant execute on function public.reserve_ai_request(numeric) to authenticated;
