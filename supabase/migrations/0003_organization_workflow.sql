alter table public.sentences
  add column if not exists organization_checked_at timestamptz;

alter table public.vocabulary_items
  add column if not exists organization_checked_at timestamptz;

create table if not exists public.custom_phrase_patterns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  term text not null,
  normalized_term text not null,
  meaning text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, normalized_term)
);

create table if not exists public.organization_changes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('vocabulary', 'phrase_pattern')),
  entity_id uuid not null,
  field_name text not null,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);

create index if not exists custom_phrase_patterns_user_term_idx
  on public.custom_phrase_patterns(user_id, normalized_term);
create index if not exists organization_changes_user_created_idx
  on public.organization_changes(user_id, created_at desc);

alter table public.custom_phrase_patterns enable row level security;
alter table public.organization_changes enable row level security;

drop policy if exists "Users manage their custom phrase patterns" on public.custom_phrase_patterns;
create policy "Users manage their custom phrase patterns" on public.custom_phrase_patterns
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users read their organization changes" on public.organization_changes;
create policy "Users read their organization changes" on public.organization_changes
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users add their organization changes" on public.organization_changes;
create policy "Users add their organization changes" on public.organization_changes
  for insert to authenticated with check (auth.uid() = user_id);

create or replace function public.apply_organization_result(
  p_processed_sources jsonb default '[]'::jsonb,
  p_suggestions jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_source jsonb;
  v_suggestion jsonb;
  v_vocabulary_id uuid;
  v_pattern_id uuid;
  v_previous_core_image text;
  v_normalized_term text;
  v_applied integer := 0;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if jsonb_array_length(coalesce(p_processed_sources, '[]'::jsonb)) > 200 then raise exception 'Too many processed sources'; end if;
  if jsonb_array_length(coalesce(p_suggestions, '[]'::jsonb)) > 300 then raise exception 'Too many suggestions'; end if;

  for v_suggestion in select * from jsonb_array_elements(coalesce(p_suggestions, '[]'::jsonb)) loop
    if v_suggestion->>'type' = 'core_image' then
      if length(coalesce(v_suggestion->>'proposed_core_image', '')) > 2000 then raise exception 'Core image is too long'; end if;
      select core_image into v_previous_core_image
      from public.vocabulary_items
      where id = (v_suggestion->>'vocabulary_id')::uuid and user_id = v_user_id
      for update;
      if found then
        update public.vocabulary_items
        set core_image = coalesce(v_suggestion->>'proposed_core_image', ''), updated_at = now(), organization_checked_at = now()
        where id = (v_suggestion->>'vocabulary_id')::uuid and user_id = v_user_id;
        insert into public.organization_changes(user_id, entity_type, entity_id, field_name, old_value, new_value)
        values(v_user_id, 'vocabulary', (v_suggestion->>'vocabulary_id')::uuid, 'core_image', v_previous_core_image, v_suggestion->>'proposed_core_image');
        v_applied := v_applied + 1;
      end if;
    elsif v_suggestion->>'type' = 'phrase' then
      if length(coalesce(v_suggestion->>'term', '')) > 200 then raise exception 'Phrase is too long'; end if;
      v_normalized_term := lower(regexp_replace(trim(v_suggestion->>'term'), '\s+', ' ', 'g'));
      if nullif(v_normalized_term, '') is null then continue; end if;

      select id into v_vocabulary_id from public.vocabulary_items
      where user_id = v_user_id and normalized_term = v_normalized_term
      for update;
      if found then
        update public.vocabulary_items set
          meaning = case when nullif(meaning, '') is null then coalesce(v_suggestion->>'meaning', '') else meaning end,
          core_image = case when nullif(core_image, '') is null then coalesce(v_suggestion->>'proposed_core_image', '') else core_image end,
          note = case when nullif(note, '') is null then coalesce(v_suggestion->>'note', '') else note end,
          organization_checked_at = now(), updated_at = now()
        where id = v_vocabulary_id;
      else
        insert into public.vocabulary_items(user_id, term, normalized_term, meaning, core_image, note, organization_checked_at)
        values(v_user_id, trim(v_suggestion->>'term'), v_normalized_term, coalesce(v_suggestion->>'meaning', ''), coalesce(v_suggestion->>'proposed_core_image', ''), coalesce(v_suggestion->>'note', ''), now())
        returning id into v_vocabulary_id;
      end if;

      if nullif(v_suggestion->>'sentence_id', '') is not null then
        insert into public.sentence_vocabulary(sentence_id, vocabulary_id, user_id, selected_text)
        select (v_suggestion->>'sentence_id')::uuid, v_vocabulary_id, v_user_id, trim(v_suggestion->>'term')
        where exists (
          select 1 from public.sentences
          where id = (v_suggestion->>'sentence_id')::uuid and user_id = v_user_id
        )
        on conflict do nothing;
      end if;

      insert into public.custom_phrase_patterns(user_id, term, normalized_term, meaning)
      values(v_user_id, trim(v_suggestion->>'term'), v_normalized_term, coalesce(v_suggestion->>'meaning', ''))
      on conflict(user_id, normalized_term) do update set
        meaning = case when nullif(custom_phrase_patterns.meaning, '') is null then excluded.meaning else custom_phrase_patterns.meaning end,
        updated_at = now()
      returning id into v_pattern_id;

      insert into public.organization_changes(user_id, entity_type, entity_id, field_name, old_value, new_value)
      values(v_user_id, 'phrase_pattern', v_pattern_id, 'term', null, trim(v_suggestion->>'term'));
      v_applied := v_applied + 1;
    end if;
  end loop;

  for v_source in select * from jsonb_array_elements(coalesce(p_processed_sources, '[]'::jsonb)) loop
    if v_source->>'kind' = 'vocabulary' then
      update public.vocabulary_items set organization_checked_at = now()
      where id = (v_source->>'id')::uuid and user_id = v_user_id;
    elsif v_source->>'kind' = 'sentence' then
      update public.sentences set organization_checked_at = now()
      where id = (v_source->>'id')::uuid and user_id = v_user_id;
    end if;
  end loop;

  return jsonb_build_object('applied', v_applied, 'processed', jsonb_array_length(coalesce(p_processed_sources, '[]'::jsonb)));
end;
$$;

grant select, insert, update, delete on public.custom_phrase_patterns to authenticated;
grant select, insert on public.organization_changes to authenticated;
grant usage, select on sequence public.organization_changes_id_seq to authenticated;
grant execute on function public.apply_organization_result(jsonb,jsonb) to authenticated;
