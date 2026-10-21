-- 微积分晋级 / Supabase schema — run in the project's SQL Editor as postgres.
-- Safe to rerun: preserves users, profiles, progress and teacher assignments.
-- Auth owns passwords and email addresses; these tables never duplicate them.
-- Learning records are client-reported practice data, not examination results.
-- Official references checked 2026-10-21:
-- https://supabase.com/docs/guides/database/functions
-- https://supabase.com/docs/guides/database/postgres/row-level-security
-- https://supabase.com/docs/guides/auth/managing-user-data
-- https://docs.postgrest.org/en/stable/references/errors.html#custom-errors

begin;

create table if not exists public.calculus_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 40),
  created_at timestamptz not null default now()
);

create table if not exists public.calculus_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 262144),
  revision bigint not null check (revision between 1 and 9007199254740991),
  rank_index integer not null check (rank_index between 0 and 6),
  completed_count integer not null check (completed_count between 0 and 21),
  stars integer not null check (stars between 0 and 63),
  xp integer not null check (xp >= 0),
  updated_at timestamptz not null default now()
);

-- Teacher membership is set only by the project owner in SQL Editor.
-- After registering and confirming YOUR account, use your Authentication user UUID:
-- insert into public.calculus_teachers (user_id) values ('YOUR-USER-UUID')
-- on conflict (user_id) do nothing;
create table if not exists public.calculus_teachers (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.calculus_profiles enable row level security;
alter table public.calculus_progress enable row level security;
alter table public.calculus_teachers enable row level security;

-- Supabase projects may have automatic table grants. Revoke them explicitly.
revoke all on public.calculus_profiles, public.calculus_progress, public.calculus_teachers
  from public, anon, authenticated;
revoke all (user_id, display_name, created_at) on public.calculus_profiles from public, anon, authenticated;
revoke all (user_id, state, revision, rank_index, completed_count, stars, xp, updated_at)
  on public.calculus_progress from public, anon, authenticated;
revoke all (user_id) on public.calculus_teachers from public, anon, authenticated;
grant select (user_id, display_name, created_at) on public.calculus_profiles to authenticated;
grant select (user_id, state, revision, rank_index, completed_count, stars, xp, updated_at)
  on public.calculus_progress to authenticated;

drop policy if exists calculus_profiles_read_own on public.calculus_profiles;
create policy calculus_profiles_read_own on public.calculus_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists calculus_progress_read_own on public.calculus_progress;
create policy calculus_progress_read_own on public.calculus_progress
  for select to authenticated using ((select auth.uid()) = user_id);
-- No client INSERT/UPDATE/DELETE policies or grants; all saves go through the RPC.
-- calculus_teachers intentionally has no client policies or table grants.

create or replace function public.handle_new_calculus_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  v_name := left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 40);
  if char_length(v_name) < 2 then v_name := '微积分学习者'; end if;
  insert into public.calculus_profiles (user_id, display_name, created_at)
    values (new.id, v_name, coalesce(new.created_at, now()))
    on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_calculus_user() from public, anon, authenticated, service_role;
drop trigger if exists calculus_auth_user_created on auth.users;
create trigger calculus_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_calculus_user();

-- This project is dedicated to this game. Backfill accounts created before this schema.
insert into public.calculus_profiles (user_id, display_name, created_at)
select u.id,
  case when char_length(btrim(coalesce(u.raw_user_meta_data ->> 'display_name', ''))) >= 2
    then left(btrim(u.raw_user_meta_data ->> 'display_name'), 40)
    else '微积分学习者' end,
  coalesce(u.created_at, now())
from auth.users u on conflict (user_id) do nothing;

-- Private helpers: no API role can execute these directly.
create or replace function public.calculus_json_integer(p_value jsonb, p_min integer, p_max integer)
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_value) = 'number'
    then (p_value::numeric = trunc(p_value::numeric)
      and p_value::numeric between p_min and p_max)
    else false end;
$$;

create or replace function public.calculus_valid_day(p_value text)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
  return to_char(p_value::date, 'YYYY-MM-DD') = p_value;
exception when datetime_field_overflow or invalid_datetime_format then return false;
end;
$$;

create or replace function public.calculus_validate_state(p_state jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_state jsonb := p_state;
  v_lessons constant text[] := array[
    'bronze-1','bronze-2','bronze-3','silver-1','silver-2','silver-3',
    'gold-1','gold-2','gold-3','platinum-1','platinum-2','platinum-3',
    'diamond-1','diamond-2','diamond-3','star-1','star-2','star-3',
    'king-1','king-2','king-3'];
  v_unlocked text[] := array[]::text[];
  v_lesson text;
  v_key text;
  v_item jsonb;
  v_session jsonb;
  v_question text;
  v_questions text[] := array[]::text[];
  v_can_advance boolean := true;
  v_best integer;
  v_stars integer;
  v_index integer;
  v_count integer;
  v_i integer;
begin
  if p_state is null or jsonb_typeof(p_state) <> 'object' or octet_length(p_state::text) > 262144 then
    raise sqlstate '22023' using message = '进度必须是小于 256 KiB 的 JSON 对象。';
  end if;
  if not (p_state ?& array['version','completed','mistakes','answered','correct','xp','streak',
      'lastStudyDate','activity','settings','savedAt','activeSession'])
    or (select count(*) from jsonb_object_keys(p_state)) <> 12
    or p_state -> 'version' <> '1'::jsonb
    or jsonb_typeof(p_state -> 'completed') <> 'object'
    or jsonb_typeof(p_state -> 'mistakes') <> 'object'
    or jsonb_typeof(p_state -> 'activity') <> 'object'
    or jsonb_typeof(p_state -> 'settings') <> 'object' then
    raise sqlstate '22023' using message = '进度版本或字段格式无效。';
  end if;
  foreach v_key in array array['answered','correct','xp','streak'] loop
    if not public.calculus_json_integer(p_state -> v_key, 0, 2147483647) then
      raise sqlstate '22023' using message = '学习统计必须为有效的非负整数。';
    end if;
  end loop;
  if (p_state ->> 'correct')::integer > (p_state ->> 'answered')::integer then
    raise sqlstate '22023' using message = '正确题数不能大于总答题数。';
  end if;
  if not (p_state -> 'settings' ? 'sound')
    or (select count(*) from jsonb_object_keys(p_state -> 'settings')) <> 1
    or jsonb_typeof(p_state #> '{settings,sound}') <> 'boolean' then
    raise sqlstate '22023' using message = '设置字段无效。';
  end if;
  if p_state -> 'lastStudyDate' <> 'null'::jsonb then
    if jsonb_typeof(p_state -> 'lastStudyDate') <> 'string'
      or not public.calculus_valid_day(p_state ->> 'lastStudyDate') then
      raise sqlstate '22023' using message = '最后学习日期无效。';
    end if;
  elsif (p_state ->> 'streak')::integer <> 0 then
    raise sqlstate '22023' using message = '连续学习天数缺少日期。';
  end if;
  if p_state -> 'savedAt' <> 'null'::jsonb then
    if jsonb_typeof(p_state -> 'savedAt') <> 'string'
      or (p_state ->> 'savedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then
      raise sqlstate '22023' using message = '保存时间格式无效。';
    end if;
    begin
      perform (p_state ->> 'savedAt')::timestamptz;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise sqlstate '22023' using message = '保存时间无效。';
    end;
  end if;
  if (select count(*) from jsonb_object_keys(p_state -> 'completed')) > 21
    or exists (select 1 from jsonb_object_keys(p_state -> 'completed') k where not k = any(v_lessons)) then
    raise sqlstate '22023' using message = '进度包含未知关卡。';
  end if;
  -- Completed results must form a contiguous path; at most its last entry may fail.
  foreach v_lesson in array v_lessons loop
    if v_can_advance then v_unlocked := array_append(v_unlocked, v_lesson); end if;
    v_item := p_state #> array['completed',v_lesson];
    if v_item is null then v_can_advance := false; continue; end if;
    if not v_can_advance or jsonb_typeof(v_item) <> 'object' then
      raise sqlstate '22023' using message = '关卡记录必须按解锁顺序保存。';
    end if;
    if not (v_item ?& array['bestCorrect','total','stars','attempts'])
      or (select count(*) from jsonb_object_keys(v_item)) <> 4
      or not public.calculus_json_integer(v_item -> 'bestCorrect', 0, 4)
      or v_item -> 'total' <> '4'::jsonb
      or not public.calculus_json_integer(v_item -> 'attempts', 1, 2147483647)
      or not public.calculus_json_integer(v_item -> 'stars', 0, 3) then
      raise sqlstate '22023' using message = '关卡成绩格式无效。';
    end if;
    v_best := (v_item ->> 'bestCorrect')::integer;
    v_can_advance := v_best >= 3;
    v_stars := case when v_best = 4 then 3 when v_best = 3 then 2 else 0 end;
    v_state := jsonb_set(v_state, array['completed',v_lesson,'stars'], to_jsonb(v_stars));
  end loop;
  if (select count(*) from jsonb_object_keys(p_state -> 'mistakes')) > 84 then
    raise sqlstate '22023' using message = '错题记录数量无效。';
  end if;
  for v_key, v_item in select key, value from jsonb_each(p_state -> 'mistakes') loop
    if jsonb_typeof(v_item) <> 'object' then
      raise sqlstate '22023' using message = '错题记录无效。';
    end if;
    if not (v_item ?& array['lessonId','count']) or (select count(*) from jsonb_object_keys(v_item)) <> 2
      or jsonb_typeof(v_item -> 'lessonId') <> 'string'
      or not coalesce((v_item ->> 'lessonId') = any(v_unlocked), false)
      or v_key not in ((v_item ->> 'lessonId') || '-q1', (v_item ->> 'lessonId') || '-q2',
        (v_item ->> 'lessonId') || '-q3', (v_item ->> 'lessonId') || '-q4')
      or not public.calculus_json_integer(v_item -> 'count', 1, 2147483647) then
      raise sqlstate '22023' using message = '错题记录指向未知或未解锁题目。';
    end if;
  end loop;
  if (select count(*) from jsonb_object_keys(p_state -> 'activity')) > 3660 then
    raise sqlstate '22023' using message = '学习日历超过可保存的 3660 天。';
  end if;
  for v_key, v_item in select key, value from jsonb_each(p_state -> 'activity') loop
    if not public.calculus_valid_day(v_key) or jsonb_typeof(v_item) <> 'object' then
      raise sqlstate '22023' using message = '学习日历格式无效。';
    end if;
    if not (v_item ?& array['answered','correct']) or (select count(*) from jsonb_object_keys(v_item)) <> 2
      or not public.calculus_json_integer(v_item -> 'answered', 0, 2147483647)
      or not public.calculus_json_integer(v_item -> 'correct', 0, 2147483647) then
      raise sqlstate '22023' using message = '每日答题统计格式无效。';
    end if;
    if (v_item ->> 'correct')::integer > (v_item ->> 'answered')::integer then
      raise sqlstate '22023' using message = '每日正确题数不能大于总答题数。';
    end if;
  end loop;
  v_session := p_state -> 'activeSession';
  if v_session <> 'null'::jsonb then
    if jsonb_typeof(v_session) <> 'object' then
      raise sqlstate '22023' using message = '正在进行的答题格式无效。';
    end if;
    if not (v_session ?& array['review','lessonId','questionIds','index','selected','answers','hint','view'])
      or (select count(*) from jsonb_object_keys(v_session)) <> 8
      or jsonb_typeof(v_session -> 'review') <> 'boolean'
      or jsonb_typeof(v_session -> 'hint') <> 'boolean'
      or jsonb_typeof(v_session -> 'questionIds') <> 'array'
      or jsonb_typeof(v_session -> 'answers') <> 'array'
      or jsonb_typeof(v_session -> 'view') <> 'string'
      or (v_session ->> 'view') not in ('lesson','quiz') then
      raise sqlstate '22023' using message = '答题快照字段无效。';
    end if;
    v_count := jsonb_array_length(v_session -> 'questionIds');
    if v_count < 1 or v_count > 84
      or not public.calculus_json_integer(v_session -> 'index', 0, v_count - 1) then
      raise sqlstate '22023' using message = '答题快照位置无效。';
    end if;
    v_index := (v_session ->> 'index')::integer;
    if jsonb_array_length(v_session -> 'answers') not in (v_index, v_index + 1)
      or (v_session -> 'selected' <> 'null'::jsonb
        and not public.calculus_json_integer(v_session -> 'selected', 0, 3)) then
      raise sqlstate '22023' using message = '答题快照选项无效。';
    end if;
    for v_item in select value from jsonb_array_elements(v_session -> 'questionIds') loop
      if jsonb_typeof(v_item) <> 'string' then
        raise sqlstate '22023' using message = '答题快照题号无效。';
      end if;
      v_question := v_item #>> '{}';
      v_lesson := regexp_replace(v_question, '-q[1-4]$', '');
      if v_question = any(v_questions) or v_question = v_lesson or not v_lesson = any(v_unlocked) then
        raise sqlstate '22023' using message = '答题快照有重复或未解锁题目。';
      end if;
      v_questions := array_append(v_questions, v_question);
    end loop;
    if (v_session ->> 'review')::boolean then
      if v_session -> 'lessonId' <> 'null'::jsonb or v_session ->> 'view' <> 'quiz' then
        raise sqlstate '22023' using message = '错题复习快照无效。';
      end if;
    else
      v_lesson := v_session ->> 'lessonId';
      if jsonb_typeof(v_session -> 'lessonId') <> 'string' or not coalesce(v_lesson = any(v_unlocked), false)
        or v_questions <> array[v_lesson || '-q1',v_lesson || '-q2',v_lesson || '-q3',v_lesson || '-q4'] then
        raise sqlstate '22023' using message = '关卡答题快照无效。';
      end if;
    end if;
    for v_i in 0..jsonb_array_length(v_session -> 'answers') - 1 loop
      v_item := v_session #> array['answers',v_i::text];
      if jsonb_typeof(v_item) <> 'object' then
        raise sqlstate '22023' using message = '答案快照无效。';
      end if;
      if not (v_item ?& array['selected','correct']) or (select count(*) from jsonb_object_keys(v_item)) <> 2
        or not public.calculus_json_integer(v_item -> 'selected', 0, 3)
        or jsonb_typeof(v_item -> 'correct') <> 'boolean' then
        raise sqlstate '22023' using message = '答案快照字段无效。';
      end if;
    end loop;
    if jsonb_array_length(v_session -> 'answers') = v_index + 1
      and v_session -> 'selected' <> v_session #> array['answers',v_index::text,'selected'] then
      raise sqlstate '22023' using message = '已提交答案与当前选择不一致。';
    end if;
    if v_session ->> 'view' = 'lesson' and (v_index <> 0
      or jsonb_array_length(v_session -> 'answers') <> 0
      or v_session -> 'selected' <> 'null'::jsonb or (v_session ->> 'hint')::boolean) then
      raise sqlstate '22023' using message = '知识卡快照无效。';
    end if;
  end if;
  return v_state;
end;
$$;

revoke all on function public.calculus_json_integer(jsonb, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.calculus_valid_day(text) from public, anon, authenticated, service_role;
revoke all on function public.calculus_validate_state(jsonb) from public, anon, authenticated, service_role;

-- Returns one row. First save expects revision 0. Every successful save increments
-- revision. A reset sends initialState through this SAME RPC with the last revision.
-- Never retry PT409 with a newer revision without first reloading the cloud state.
create or replace function public.calculus_save_progress(p_state jsonb, p_expected_revision bigint)
returns setof public.calculus_progress language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_state jsonb;
  v_count integer;
  v_stars integer;
  v_row public.calculus_progress%rowtype;
begin
  if v_uid is null or not exists (select 1 from auth.users u where u.id = v_uid
      and u.email_confirmed_at is not null and coalesce(u.is_anonymous, false) = false) then
    raise sqlstate '42501' using message = '请先登录已验证邮箱的注册账号。';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_expected_revision >= 9007199254740991 then
    raise sqlstate '22023' using message = '存档版本号无效。';
  end if;
  v_state := public.calculus_validate_state(p_state);
  select count(*) filter (where (value ->> 'bestCorrect')::integer >= 3)::integer,
    coalesce(sum((value ->> 'stars')::integer), 0)::integer
    into v_count, v_stars from jsonb_each(v_state -> 'completed');
  -- Repair a missing profile for an older account, without trusting client identity.
  insert into public.calculus_profiles (user_id, display_name, created_at)
  select u.id, case when char_length(btrim(coalesce(u.raw_user_meta_data ->> 'display_name',''))) >= 2
    then left(btrim(u.raw_user_meta_data ->> 'display_name'),40) else '微积分学习者' end,
    coalesce(u.created_at,now()) from auth.users u where u.id = v_uid
    on conflict (user_id) do nothing;
  if p_expected_revision = 0 then
    insert into public.calculus_progress (user_id,state,revision,rank_index,completed_count,stars,xp,updated_at)
      values (v_uid,v_state,1,least(v_count / 3,6),v_count,v_stars,(v_state ->> 'xp')::integer,now())
      on conflict (user_id) do nothing returning * into v_row;
  else
    update public.calculus_progress p set state = v_state, revision = p.revision + 1,
      rank_index = least(v_count / 3,6), completed_count = v_count, stars = v_stars,
      xp = (v_state ->> 'xp')::integer, updated_at = now()
      where p.user_id = v_uid and p.revision = p_expected_revision returning p.* into v_row;
  end if;
  if not found then
    raise sqlstate 'PT409' using message = '云端进度已更新，请重新载入后继续。',
      hint = 'CALCULUS_REVISION_CONFLICT';
  end if;
  return next v_row;
end;
$$;

create or replace function public.calculus_is_teacher()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.calculus_teachers t join auth.users u on u.id = t.user_id
    where t.user_id = auth.uid() and u.email_confirmed_at is not null
      and coalesce(u.is_anonymous, false) = false
  );
$$;

create or replace function public.calculus_teacher_progress(p_offset integer default 0, p_limit integer default 100)
returns table (user_id uuid, display_name text, rank_index integer, completed_count integer,
  stars integer, xp integer, updated_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.calculus_is_teacher() then
    raise sqlstate '42501' using message = '只有教师账号可以查看学生学习记录。';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 10000000
    or p_limit is null or p_limit < 1 or p_limit > 200 then
    raise sqlstate '22023' using message = '分页参数无效（每页最多 200 条）。';
  end if;
  return query select p.user_id, p.display_name, coalesce(g.rank_index,0),
    coalesce(g.completed_count,0), coalesce(g.stars,0), coalesce(g.xp,0), g.updated_at, p.created_at
    from public.calculus_profiles p
    left join public.calculus_progress g on g.user_id = p.user_id
    order by p.created_at desc, p.user_id asc offset p_offset limit p_limit;
end;
$$;

revoke all on function public.calculus_save_progress(jsonb,bigint) from public, anon, authenticated, service_role;
revoke all on function public.calculus_is_teacher() from public, anon, authenticated, service_role;
revoke all on function public.calculus_teacher_progress(integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.calculus_save_progress(jsonb,bigint) to authenticated;
grant execute on function public.calculus_is_teacher() to authenticated;
grant execute on function public.calculus_teacher_progress(integer,integer) to authenticated;

-- Refresh PostgREST's function/table metadata after deployment.
notify pgrst, 'reload schema';
commit;
