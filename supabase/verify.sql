-- Run AFTER schema.sql in Supabase SQL Editor as postgres.
-- Every fixture and change is inside this transaction and rolled back at the end.
-- This script sends no mail, stores no passwords, and never touches existing users.
-- Any failed assertion stops execution; use ROLLBACK if your SQL client leaves it open.
begin;

do $$
begin
  if exists (select 1 from auth.users where id in (
    'ca1c0100-0000-4000-8000-000000000001'::uuid,
    'ca1c0100-0000-4000-8000-000000000002'::uuid,
    'ca1c0100-0000-4000-8000-000000000003'::uuid)) then
    raise exception 'Verification fixture UUID already exists; no existing data was changed.';
  end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in
        ('calculus_profiles','calculus_progress','calculus_teachers') and c.relrowsecurity) <> 3 then
    raise exception 'FAIL: all three app tables must have RLS enabled';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in
      ('calculus_save_progress','calculus_is_teacher','calculus_teacher_progress','handle_new_calculus_user')
      and (not p.prosecdef or not ('search_path=""' = any(coalesce(p.proconfig,array[]::text[]))))) then
    raise exception 'FAIL: security-definer functions must pin an empty search_path';
  end if;
end;
$$;

insert into auth.users (id,email,raw_user_meta_data,email_confirmed_at,created_at,updated_at,role,aud)
values
  ('ca1c0100-0000-4000-8000-000000000001','calculus-verify-a@example.invalid',
    '{"display_name":"  测试学生甲  "}',now(),now(),now(),'authenticated','authenticated'),
  ('ca1c0100-0000-4000-8000-000000000002','calculus-verify-b@example.invalid',
    '{"display_name":"测试学生乙"}',now(),now(),now(),'authenticated','authenticated'),
  ('ca1c0100-0000-4000-8000-000000000003','calculus-verify-c@example.invalid',
    '{"display_name":"未验证学生"}',null,now(),now(),'authenticated','authenticated');

select set_config('calculus.test_state', '{"version":1,"completed":{},"mistakes":{},"answered":0,
  "correct":0,"xp":0,"streak":0,"lastStudyDate":null,"activity":{},"settings":{"sound":false},
  "savedAt":null,"activeSession":null}', true);

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
do $$
begin
  begin
    perform * from public.calculus_profiles;
    raise exception 'FAIL: anonymous profile read allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.calculus_progress;
    raise exception 'FAIL: anonymous progress read allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.calculus_save_progress(current_setting('calculus.test_state')::jsonb,0);
    raise exception 'FAIL: anonymous save allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.calculus_is_teacher();
    raise exception 'FAIL: anonymous teacher RPC allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.calculus_teacher_progress();
    raise exception 'FAIL: anonymous teacher listing allowed';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','ca1c0100-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"ca1c0100-0000-4000-8000-000000000001","role":"authenticated","user_metadata":{"teacher":true}}',true);
do $$
declare
  v_state jsonb := current_setting('calculus.test_state')::jsonb;
  v_changed jsonb;
  v_row record;
begin
  if (select count(*) from public.calculus_profiles) <> 1
    or (select display_name from public.calculus_profiles) <> '测试学生甲' then
    raise exception 'FAIL: profile isolation or registration trigger';
  end if;
  if public.calculus_is_teacher() then raise exception 'FAIL: metadata granted teacher rights'; end if;
  begin
    perform * from public.calculus_teacher_progress();
    raise exception 'FAIL: student accessed teacher list';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.calculus_teachers;
    raise exception 'FAIL: student read teacher membership';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.calculus_teachers(user_id) values(auth.uid());
    raise exception 'FAIL: student granted themselves teacher membership';
  exception when insufficient_privilege then null; end;
  begin
    update public.calculus_profiles set display_name = '直接写入';
    raise exception 'FAIL: direct profile update allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.calculus_progress(user_id,state,revision,rank_index,completed_count,stars,xp)
      values(auth.uid(),v_state,1,6,21,63,0);
    raise exception 'FAIL: direct progress insert allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.calculus_validate_state(v_state);
    raise exception 'FAIL: private validation helper exposed';
  exception when insufficient_privilege then null; end;

  select * into v_row from public.calculus_save_progress(v_state,0);
  if v_row.user_id <> auth.uid() or v_row.revision <> 1 or v_row.rank_index <> 0 then
    raise exception 'FAIL: first save identity or revision';
  end if;
  begin
    perform * from public.calculus_save_progress(v_state,0);
    raise exception 'FAIL: repeated first save overwrote progress';
  exception when sqlstate 'PT409' then null; end;

  -- Three consecutive passes unlock Silver. Client stars are deliberately incorrect.
  v_changed := jsonb_set(v_state,'{completed}', '{
    "bronze-1":{"bestCorrect":4,"total":4,"stars":0,"attempts":1},
    "bronze-2":{"bestCorrect":3,"total":4,"stars":3,"attempts":1},
    "bronze-3":{"bestCorrect":3,"total":4,"stars":0,"attempts":2}}');
  select * into v_row from public.calculus_save_progress(v_changed,1);
  if v_row.revision <> 2 or v_row.rank_index <> 1 or v_row.completed_count <> 3
    or v_row.stars <> 7 or v_row.state #>> '{completed,bronze-1,stars}' <> '3' then
    raise exception 'FAIL: server did not derive rank and stars from bestCorrect';
  end if;
  begin
    perform * from public.calculus_save_progress(v_state,1);
    raise exception 'FAIL: stale revision overwrote newer progress';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform * from public.calculus_save_progress(jsonb_set(v_state,'{completed}',
      '{"king-3":{"bestCorrect":4,"total":4,"stars":3,"attempts":1}}'),2);
    raise exception 'FAIL: skipped prerequisites accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform * from public.calculus_save_progress(v_state - 'activity',2);
    raise exception 'FAIL: incomplete state accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform * from public.calculus_save_progress(jsonb_set(v_state,'{correct}','1'),2);
    raise exception 'FAIL: correct exceeded answered';
  exception when invalid_parameter_value then null; end;
  begin
    perform * from public.calculus_save_progress(jsonb_set(v_state,'{xp}','-1'),2);
    raise exception 'FAIL: negative XP accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform * from public.calculus_save_progress(v_state || jsonb_build_object('extra',repeat('x',262145)),2);
    raise exception 'FAIL: oversized state accepted';
  exception when invalid_parameter_value then null; end;

  -- A valid in-flight quiz survives a cloud save, including an answered question.
  v_changed := jsonb_set(v_state,'{activeSession}', '{"review":false,"lessonId":"bronze-1",
    "questionIds":["bronze-1-q1","bronze-1-q2","bronze-1-q3","bronze-1-q4"],
    "index":0,"selected":1,"answers":[{"selected":1,"correct":true}],"hint":false,"view":"quiz"}');
  select * into v_row from public.calculus_save_progress(v_changed,2);
  if v_row.revision <> 3 or v_row.state -> 'activeSession' <> v_changed -> 'activeSession' then
    raise exception 'FAIL: active quiz did not round-trip';
  end if;
  begin
    perform * from public.calculus_save_progress(jsonb_set(v_changed,'{activeSession,view}','null'),3);
    raise exception 'FAIL: malformed session accepted';
  exception when invalid_parameter_value then null; end;
  -- Reset increments the revision rather than deleting the row.
  select * into v_row from public.calculus_save_progress(v_state,3);
  if v_row.revision <> 4 or v_row.completed_count <> 0 or v_row.state <> v_state then
    raise exception 'FAIL: reset did not preserve revision history';
  end if;
  begin
    perform * from public.calculus_save_progress(v_changed,3);
    raise exception 'FAIL: old device restored pre-reset progress';
  exception when sqlstate 'PT409' then null; end;
  begin
    update public.calculus_progress set xp = 999;
    raise exception 'FAIL: direct progress update allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.calculus_progress;
    raise exception 'FAIL: direct progress deletion allowed';
  exception when insufficient_privilege then null; end;
end;
$$;

select set_config('request.jwt.claim.sub','ca1c0100-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"ca1c0100-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$
declare v_row record;
begin
  if (select count(*) from public.calculus_profiles) <> 1
    or (select count(*) from public.calculus_progress) <> 0 then
    raise exception 'FAIL: second student saw first student data';
  end if;
  select * into v_row from public.calculus_save_progress(current_setting('calculus.test_state')::jsonb,0);
  if v_row.user_id <> auth.uid() or v_row.revision <> 1
    or (select count(*) from public.calculus_progress) <> 1 then
    raise exception 'FAIL: second student save or isolation';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub','ca1c0100-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"ca1c0100-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$
begin
  begin
    perform * from public.calculus_save_progress(current_setting('calculus.test_state')::jsonb,0);
    raise exception 'FAIL: unconfirmed email saved progress';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;

-- Only the database owner grants teacher status.
insert into public.calculus_teachers(user_id) values('ca1c0100-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','ca1c0100-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"ca1c0100-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
begin
  if not public.calculus_is_teacher() then raise exception 'FAIL: owner-assigned teacher not recognized'; end if;
  if not exists (select 1 from public.calculus_teacher_progress(0,200)
      where user_id = 'ca1c0100-0000-4000-8000-000000000002'::uuid) then
    raise exception 'FAIL: teacher could not read second student';
  end if;
  if (select count(*) from public.calculus_progress) <> 1 then
    raise exception 'FAIL: teacher acquired direct cross-user table access';
  end if;
  begin
    perform * from public.calculus_teacher_progress(0,201);
    raise exception 'FAIL: teacher pagination limit not enforced';
  exception when invalid_parameter_value then null; end;
end;
$$;
reset role;

do $$
begin
  if (select revision from public.calculus_progress where user_id = 'ca1c0100-0000-4000-8000-000000000001') <> 4
    or (select revision from public.calculus_progress where user_id = 'ca1c0100-0000-4000-8000-000000000002') <> 1 then
    raise exception 'FAIL: owner audit found unexpected student revisions';
  end if;
  raise notice 'PASS: anonymous denial, account isolation, registration trigger, validation, rank derivation, CAS, reset, email confirmation and teacher authorization.';
end;
$$;

rollback;
