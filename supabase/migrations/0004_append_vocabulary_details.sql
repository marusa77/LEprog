-- Adds append-only vocabulary explanations. Does not rewrite existing records.
begin;

create or replace function public.append_learning_text(p_existing text, p_addition text)
returns text
language plpgsql immutable parallel safe
set search_path = public
as $$
declare
  v_separator constant text := E'\n\n──────────\n【追記】\n\n';
  v_result text := coalesce(p_existing, '');
  v_block text;
begin
  for v_block in select unnest(string_to_array(coalesce(p_addition, ''), v_separator)) loop
    v_block := btrim(v_block, E' \t\r\n');
    if v_block = '' then continue; end if;
    if not exists (
      select 1 from unnest(string_to_array(v_result, v_separator)) as parts(body)
      where regexp_replace(btrim(body, E' \t\r\n'), '\s+', ' ', 'g')
          = regexp_replace(v_block, '\s+', ' ', 'g')
    ) then
      if btrim(v_result, E' \t\r\n') = '' then v_result := v_block;
      else v_result := v_result || v_separator || v_block;
      end if;
    end if;
  end loop;
  return v_result;
end;
$$;

create or replace function public.append_vocabulary_details(
  p_vocabulary_id uuid,
  p_meaning text default '',
  p_core_image text default '',
  p_note text default ''
) returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated public.vocabulary_items%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if btrim(coalesce(p_meaning, '') || coalesce(p_core_image, '') || coalesce(p_note, ''), E' \t\r\n') = '' then
    raise exception 'An additional explanation is required';
  end if;
  update public.vocabulary_items set
    meaning = public.append_learning_text(meaning, p_meaning),
    core_image = public.append_learning_text(core_image, p_core_image),
    note = public.append_learning_text(note, p_note),
    updated_at = case when
      meaning is distinct from public.append_learning_text(meaning, p_meaning) or
      core_image is distinct from public.append_learning_text(core_image, p_core_image) or
      note is distinct from public.append_learning_text(note, p_note)
      then now() else updated_at end
  where id = p_vocabulary_id and user_id = v_user_id
  returning * into v_updated;
  if not found then raise exception 'Vocabulary not found or not allowed' using errcode = '42501'; end if;
  return to_jsonb(v_updated);
end;
$$;

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
language plpgsql security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_sentence_id uuid;
  v_term jsonb;
  v_vocabulary_id uuid;
  v_normalized text;
  v_was_existing boolean;
  v_results jsonb := '[]'::jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_original_text), '') is null then raise exception 'Original text is required'; end if;

  insert into public.sentences(user_id, original_text, machine_translation, translation, note, source_url, source_title, subreddit)
  values(v_user_id, trim(p_original_text), p_machine_translation, coalesce(p_translation,''), coalesce(p_note,''), p_source_url, p_source_title, p_subreddit)
  returning id into v_sentence_id;

  for v_term in select * from jsonb_array_elements(coalesce(p_terms, '[]'::jsonb)) loop
    v_normalized := lower(regexp_replace(trim(v_term->>'term'), '\s+', ' ', 'g'));
    -- The unique key handles simultaneous saves without making duplicate words.
    insert into public.vocabulary_items(user_id, term, normalized_term, meaning, core_image, note)
    values(v_user_id, trim(v_term->>'term'), v_normalized,
      public.append_learning_text('', v_term->>'meaning'),
      public.append_learning_text('', v_term->>'core_image'),
      public.append_learning_text('', v_term->>'note'))
    on conflict (user_id, normalized_term) do nothing
    returning id into v_vocabulary_id;
    v_was_existing := v_vocabulary_id is null;

    if v_was_existing then
      -- Row updates are atomic: concurrent additions do not replace each other.
      update public.vocabulary_items set
        occurrence_count = occurrence_count + 1,
        priority_score = priority_score + 1,
        last_seen_at = now(),
        meaning = public.append_learning_text(meaning, v_term->>'meaning'),
        core_image = public.append_learning_text(core_image, v_term->>'core_image'),
        note = public.append_learning_text(note, v_term->>'note'),
        updated_at = now()
      where user_id = v_user_id and normalized_term = v_normalized
      returning id into v_vocabulary_id;
      if not found then raise exception 'Vocabulary not found or not allowed' using errcode = '42501'; end if;
    end if;

    insert into public.sentence_vocabulary(sentence_id, vocabulary_id, user_id, selected_text)
    values(v_sentence_id, v_vocabulary_id, v_user_id, trim(v_term->>'term')) on conflict do nothing;
    v_results := v_results || jsonb_build_array(jsonb_build_object('id', v_vocabulary_id, 'term', v_term->>'term', 'existing', v_was_existing));
  end loop;
  return jsonb_build_object('sentence_id', v_sentence_id, 'terms', v_results, 'details_appending', true);
end;
$$;

revoke all on function public.append_learning_text(text,text) from public, anon;
revoke all on function public.append_vocabulary_details(uuid,text,text,text) from public, anon;
grant execute on function public.append_learning_text(text,text) to authenticated;
grant execute on function public.append_vocabulary_details(uuid,text,text,text) to authenticated;
grant execute on function public.save_capture(text,text,text,text,text,text,text,jsonb) to authenticated;

-- Check the real SQL helper before committing the function changes.
do $$
declare
  v_separator constant text := E'\n\n──────────\n【追記】\n\n';
  v_saved text;
begin
  v_saved := public.append_learning_text('元の説明', '追加の説明');
  if v_saved <> '元の説明' || v_separator || '追加の説明' then raise exception 'Append check failed'; end if;
  if public.append_learning_text(v_saved, '追加の説明') <> v_saved then raise exception 'Duplicate check failed'; end if;
  if public.append_learning_text(v_saved, v_saved) <> v_saved then raise exception 'Full-text check failed'; end if;
  if public.append_learning_text(v_saved, E' \n\t') <> v_saved then raise exception 'Blank check failed'; end if;
  if public.append_learning_text(E'line one\nline two', 'line one line two') <> E'line one\nline two' then raise exception 'Whitespace check failed'; end if;
  if public.append_learning_text(null, '最初の説明') <> '最初の説明' then raise exception 'Initial check failed'; end if;
end;
$$;
notify pgrst, 'reload schema';
commit;
