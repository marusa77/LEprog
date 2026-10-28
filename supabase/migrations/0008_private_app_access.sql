-- Run after 0001-0007, using the Supabase SQL Editor as the project owner.
-- No learning records are changed. Existing ownership policies remain in force.
begin;

create schema if not exists phrasenest_private;
revoke all on schema phrasenest_private from public, anon, authenticated;
grant usage on schema phrasenest_private to authenticated;

create table if not exists phrasenest_private.allowed_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table phrasenest_private.allowed_users enable row level security;
revoke all on phrasenest_private.allowed_users from public, anon, authenticated;

-- This is an administrator-only migration, not a first-visitor enrollment API.
-- With several Auth users, replace NULL below with your own UUID, e.g.
-- v_owner_id uuid := 'YOUR-USER-ID'::uuid;
-- With exactly one existing Auth user, no editing is necessary.
do $$
declare v_owner_id uuid := null; v_candidates uuid[];
begin
  if v_owner_id is not null then
    if not exists(select 1 from auth.users where id=v_owner_id) then raise exception 'Owner UUID was not found in Authentication / Users'; end if;
    insert into phrasenest_private.allowed_users(user_id) values(v_owner_id) on conflict do nothing;
  elsif not exists(select 1 from phrasenest_private.allowed_users) then
    select array_agg(id) into v_candidates from auth.users;
    if coalesce(cardinality(v_candidates),0) <> 1 then
      raise exception 'Set v_owner_id to your Authentication / Users UUID. No changes were applied.';
    end if;
    insert into phrasenest_private.allowed_users(user_id) values(v_candidates[1]);
  end if;
end; $$;

create or replace function phrasenest_private.is_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(
    select 1 from phrasenest_private.allowed_users where user_id=auth.uid()
  );
$$;
revoke all on function phrasenest_private.is_allowed() from public, anon, authenticated;
grant execute on function phrasenest_private.is_allowed() to authenticated;

create or replace function public.app_access_status()
returns boolean language sql stable security invoker set search_path = '' as $$
  select phrasenest_private.is_allowed();
$$;
revoke all on function public.app_access_status() from public, anon;
grant execute on function public.app_access_status() to authenticated;

-- A restrictive policy combines with (does not replace) the existing owner rule.
-- A write trigger also protects internal SECURITY DEFINER writes with a user JWT.
create or replace function phrasenest_private.guard_user_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not phrasenest_private.is_allowed() then
    raise exception 'This account is not allowed to use this app' using errcode='42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;
revoke all on function phrasenest_private.guard_user_write() from public, anon, authenticated;

do $$
declare v_table text;
begin
  foreach v_table in array array['sentences','vocabulary_items','sentence_vocabulary','review_logs','monthly_usage','custom_phrase_patterns','organization_changes','sentence_review_events','knowledge_notes','learning_activity_events'] loop
    if not exists(select 1 from pg_policies where schemaname='public' and tablename=v_table and policyname='PhraseNest allowed accounts') then
      execute format('create policy "PhraseNest allowed accounts" on public.%I as restrictive for all to authenticated using ((select phrasenest_private.is_allowed())) with check ((select phrasenest_private.is_allowed()))', v_table);
    end if;
    if not exists(select 1 from pg_trigger where tgrelid=format('public.%I',v_table)::regclass and tgname='phrasenest_guard_user_write' and not tgisinternal) then
      execute format('create trigger phrasenest_guard_user_write before insert or update or delete on public.%I for each row execute function phrasenest_private.guard_user_write()',v_table);
    end if;
  end loop;
end; $$;

-- These functions run as the owner: check access explicitly before reserving
-- usage, so the existing Edge Functions cannot spend an unauthorized user's quota.
create or replace function public.reserve_cloud_translation(p_characters integer)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user_id uuid := auth.uid(); v_month date := date_trunc('month', now())::date; v_total integer;
begin
  if not phrasenest_private.is_allowed() then raise exception 'This account is not allowed to use this app' using errcode='42501'; end if;
  if p_characters < 1 or p_characters > 5000 then raise exception 'Invalid character count'; end if;
  insert into public.monthly_usage(user_id, month, cloud_translation_characters)
  values(v_user_id, v_month, p_characters)
  on conflict(user_id, month) do update set cloud_translation_characters=monthly_usage.cloud_translation_characters+excluded.cloud_translation_characters
  returning cloud_translation_characters into v_total;
  if v_total > 450000 then raise exception 'Monthly cloud translation limit reached'; end if;
  return v_total;
end; $$;
revoke all on function public.reserve_cloud_translation(integer) from public, anon;
grant execute on function public.reserve_cloud_translation(integer) to authenticated;

create or replace function public.reserve_ai_request(p_estimated_usd numeric default 0.001)
returns numeric language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user_id uuid := auth.uid(); v_month date := date_trunc('month', now())::date; v_total numeric;
begin
  if not phrasenest_private.is_allowed() then raise exception 'This account is not allowed to use this app' using errcode='42501'; end if;
  if p_estimated_usd <= 0 or p_estimated_usd > 0.05 then raise exception 'Invalid estimate'; end if;
  insert into public.monthly_usage(user_id, month, ai_requests, ai_estimated_usd)
  values(v_user_id, v_month, 1, p_estimated_usd)
  on conflict(user_id, month) do update set ai_requests=monthly_usage.ai_requests+1, ai_estimated_usd=monthly_usage.ai_estimated_usd+excluded.ai_estimated_usd
  returning ai_estimated_usd into v_total;
  if v_total > 1 then raise exception 'Monthly AI budget reached'; end if;
  return v_total;
end; $$;

revoke all on function public.reserve_ai_request(numeric) from public, anon;
grant execute on function public.reserve_ai_request(numeric) to authenticated;
commit;
notify pgrst, 'reload schema';
