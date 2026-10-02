alter table public.vocabulary_items
  add column if not exists core_image text not null default '';

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
        core_image = case when nullif(core_image,'') is null then coalesce(v_term->>'core_image','') else core_image end,
        note = case when nullif(note,'') is null then coalesce(v_term->>'note','') else note end,
        updated_at = now()
      where id = v_vocabulary_id;
    else
      insert into public.vocabulary_items(user_id, term, normalized_term, meaning, core_image, note)
      values(v_user_id, trim(v_term->>'term'), lower(regexp_replace(trim(v_term->>'term'), '\s+', ' ', 'g')), coalesce(v_term->>'meaning',''), coalesce(v_term->>'core_image',''), coalesce(v_term->>'note',''))
      returning id into v_vocabulary_id;
    end if;

    insert into public.sentence_vocabulary(sentence_id, vocabulary_id, user_id, selected_text)
    values(v_sentence_id, v_vocabulary_id, v_user_id, trim(v_term->>'term')) on conflict do nothing;
    v_results := v_results || jsonb_build_array(jsonb_build_object('id', v_vocabulary_id, 'term', v_term->>'term', 'existing', v_was_existing));
  end loop;

  return jsonb_build_object('sentence_id', v_sentence_id, 'terms', v_results);
end;
$$;

grant execute on function public.save_capture(text,text,text,text,text,text,text,jsonb) to authenticated;
