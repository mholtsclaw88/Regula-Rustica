begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select has_function(
  'private', 'retire_legacy_routine_foundation', array[]::text[],
  'legacy Routine retirement helper exists'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '00000000-0000-0000-0000-000000000000',
  'a8100000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'resync-steward@example.test',
  crypt('password', gen_salt('bf')), now(), now(), now(), '{}', '{}', false
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a8100000-0000-0000-0000-000000000001', true);
select public.create_homestead('Resync Stabilization Test') as homestead_id \gset
reset role;

insert into public.records (id, homestead_id, type, name, status, identity, created_by, updated_by)
values (
  'a8200000-0000-0000-0000-000000000001', :'homestead_id', 'animal', 'Legacy Dairy Cow', 'active',
  '{"purpose":"Dairy"}', 'a8100000-0000-0000-0000-000000000001', 'a8100000-0000-0000-0000-000000000001'
);

insert into public.tasks (
  id, homestead_id, record_id, title, status, priority, due_date, recurrence_rule,
  completed_at, completed_by, created_by, updated_by
) values (
  'a8300000-0000-0000-0000-000000000001', :'homestead_id', 'a8200000-0000-0000-0000-000000000001',
  'Morning Milking', 'completed', 'normal', current_date - 2,
  '{"mode":"fixed_schedule","frequency":"daily","interval":1,"enabled":true,"seriesId":"a8400000-0000-0000-0000-000000000001","routineType":"milk_morning"}',
  now(), 'a8100000-0000-0000-0000-000000000001',
  'a8100000-0000-0000-0000-000000000001', 'a8100000-0000-0000-0000-000000000001'
), (
  'a8300000-0000-0000-0000-000000000002', :'homestead_id', 'a8200000-0000-0000-0000-000000000001',
  'Morning Milking', 'open', 'normal', current_date - 1,
  '{"mode":"fixed_schedule","frequency":"daily","interval":1,"enabled":true,"seriesId":"a8400000-0000-0000-0000-000000000001"}',
  null, null,
  'a8100000-0000-0000-0000-000000000001', 'a8100000-0000-0000-0000-000000000001'
);

insert into public.routines (
  id, homestead_id, record_id, name, routine_type, enabled, frequency, interval,
  first_date, next_date, created_by, updated_by
) values (
  'a8500000-0000-0000-0000-000000000001', :'homestead_id', 'a8200000-0000-0000-0000-000000000001',
  'Morning Milking', 'milk_morning', true, 'daily', 1, current_date - 1, current_date,
  'a8100000-0000-0000-0000-000000000001', 'a8100000-0000-0000-0000-000000000001'
);

insert into public.routine_occurrences (
  id, homestead_id, routine_id, occurrence_date, status, created_by, updated_by
) values (
  'a8600000-0000-0000-0000-000000000001', :'homestead_id', 'a8500000-0000-0000-0000-000000000001',
  current_date, 'pending', 'a8100000-0000-0000-0000-000000000001', 'a8100000-0000-0000-0000-000000000001'
);

select private.retire_legacy_routine_foundation();
select private.retire_legacy_routine_foundation();

select ok((select deleted_at is not null and not enabled from public.routines where id='a8500000-0000-0000-0000-000000000001'), 'legacy Routine is disabled and soft-deleted');
select ok((select deleted_at is not null from public.routine_occurrences where id='a8600000-0000-0000-0000-000000000001'), 'legacy Routine occurrence is soft-deleted');
select is((select recurrence_rule ->> 'seriesDeleted' from public.tasks where id='a8300000-0000-0000-0000-000000000001'), 'true', 'legacy Task root is marked as a deleted series');
select is((select recurrence_rule ->> 'enabled' from public.tasks where id='a8300000-0000-0000-0000-000000000001'), 'false', 'legacy Task root is disabled');
select ok((select deleted_at is null from public.tasks where id='a8300000-0000-0000-0000-000000000001'), 'completed legacy Task history remains recoverable');
select is((select recurrence_rule ->> 'seriesDeleted' from public.tasks where id='a8300000-0000-0000-0000-000000000002'), 'true', 'descendant without legacy keys is retired through its series ID');
select ok((select deleted_at is not null from public.tasks where id='a8300000-0000-0000-0000-000000000002'), 'open legacy descendant is soft-deleted');

select * from finish();
rollback;
