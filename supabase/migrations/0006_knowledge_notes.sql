-- Independent personal knowledge notes. No existing sentences, vocabulary,
-- core images, organization markers or review schedules are changed.
begin;

create table if not exists public.knowledge_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null check (char_length(btrim(body)) > 0 and char_length(body) <= 50000),
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_notes_user_updated_idx
  on public.knowledge_notes(user_id, updated_at desc, id);

alter table public.knowledge_notes enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'knowledge_notes' and policyname = 'Read own knowledge notes') then
    create policy "Read own knowledge notes" on public.knowledge_notes
      for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'knowledge_notes' and policyname = 'Create own knowledge notes') then
    create policy "Create own knowledge notes" on public.knowledge_notes
      for insert to authenticated with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'knowledge_notes' and policyname = 'Edit own knowledge notes') then
    create policy "Edit own knowledge notes" on public.knowledge_notes
      for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end;
$$;

create or replace function public.touch_knowledge_note()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.knowledge_notes'::regclass and tgname = 'knowledge_note_updated_at') then
    create trigger knowledge_note_updated_at before update on public.knowledge_notes
      for each row execute function public.touch_knowledge_note();
  end if;
end;
$$;

-- Client code cannot replace ownership or creation timestamps, nor delete notes.
revoke all on public.knowledge_notes from public, anon, authenticated;
grant select on public.knowledge_notes to authenticated;
grant insert (id, title, body, needs_review) on public.knowledge_notes to authenticated;
grant update (title, body, needs_review) on public.knowledge_notes to authenticated;
revoke all on function public.touch_knowledge_note() from public;
grant execute on function public.touch_knowledge_note() to authenticated;

commit;
notify pgrst, 'reload schema';
