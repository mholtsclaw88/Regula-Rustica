begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select has_function(
  'public', 'complete_recurring_task', array['uuid','text','uuid'],
  'recurring completion RPC exists'
);
select has_function(
  'public', 'apply_task_sync_operation',
  array['text','uuid','text','uuid','text','integer','timestamp with time zone','jsonb'],
  'Task sync RPC exists'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '00000000-0000-0000-0000-000000000000',
  '91000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'skip-steward@example.test',
  crypt('password', gen_salt('bf')), now(), now(), now(), '{}', '{}', false
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true);
select public.create_homestead('Skip Test Homestead') as homestead_id \gset
reset role;

insert into public.tasks (
  id, homestead_id, title, status, priority, due_date, recurrence_rule,
  created_by, updated_by
) values (
  '92000000-0000-0000-0000-000000000001', :'homestead_id', 'Daily source', 'open', 'normal', current_date,
  '{"mode":"fixed_schedule","frequency":"daily","interval":1,"enabled":true,"seriesId":"93000000-0000-0000-0000-000000000001"}',
  '91000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001'
), (
  '92000000-0000-0000-0000-000000000002', :'homestead_id', 'Skipped tomorrow', 'open', 'normal', current_date + 1,
  '{"mode":"fixed_schedule","frequency":"daily","interval":1,"enabled":true,"seriesId":"93000000-0000-0000-0000-000000000001"}',
  '91000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001'
), (
  '92000000-0000-0000-0000-000000000003', :'homestead_id', 'Skipped on another device', 'open', 'normal', current_date + 2,
  '{"mode":"fixed_schedule","frequency":"daily","interval":1,"enabled":true,"seriesId":"93000000-0000-0000-0000-000000000002"}',
  '91000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001'
);

select set_config('regula.allow_deleted_state', 'true', true);
update public.tasks
set deleted_at = now(), deleted_by = '91000000-0000-0000-0000-000000000001'
where id in (
  '92000000-0000-0000-0000-000000000002',
  '92000000-0000-0000-0000-000000000003'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true);
select is(
  public.complete_recurring_task(
    '92000000-0000-0000-0000-000000000001', 'complete-with-skipped-next',
    '94000000-0000-0000-0000-000000000001'
  ),
  null::uuid,
  'completion does not return or recreate a skipped next occurrence'
);
select is(
  (select status from public.tasks where id = '92000000-0000-0000-0000-000000000001'),
  'completed',
  'source occurrence still completes normally'
);
select is(
  (select count(*) from public.tasks
   where homestead_id = :'homestead_id'
     and recurrence_rule ->> 'seriesId' = '93000000-0000-0000-0000-000000000001'
     and due_date = current_date + 1),
  1::bigint,
  'completion preserves exactly one skipped series/date tombstone'
);
select is(
  (select count(*) from public.tasks
   where homestead_id = :'homestead_id'
     and recurrence_rule ->> 'seriesId' = '93000000-0000-0000-0000-000000000001'
     and due_date = current_date + 1 and deleted_at is null),
  0::bigint,
  'completion does not create an active replacement for a skipped date'
);

select public.apply_task_sync_operation(
  'remote-create-on-skipped-date', '94000000-0000-0000-0000-000000000002', 'tasks',
  '92000000-0000-0000-0000-000000000004', 'create', null, now(),
  jsonb_build_object(
    'title', 'Remote duplicate', 'status', 'open', 'priority', 'normal',
    'due_date', (current_date + 2)::text,
    'recurrence_rule', jsonb_build_object(
      'mode', 'fixed_schedule', 'frequency', 'daily', 'interval', 1, 'enabled', true,
      'seriesId', '93000000-0000-0000-0000-000000000002'
    )
  )
) as sync_result \gset
select is(
  (:'sync_result'::jsonb -> 'row' ->> 'id'),
  '92000000-0000-0000-0000-000000000003',
  'another-device create resolves to the existing skipped tombstone'
);
select is(
  (select count(*) from public.tasks
   where homestead_id = :'homestead_id'
     and recurrence_rule ->> 'seriesId' = '93000000-0000-0000-0000-000000000002'
     and due_date = current_date + 2 and deleted_at is null),
  0::bigint,
  'another device cannot activate a skipped series/date'
);
reset role;

select * from finish();
rollback;
