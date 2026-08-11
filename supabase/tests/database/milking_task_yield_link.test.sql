begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

select has_column('public', 'yield_entries', 'task_id', 'Yield has an explicit Task link');
select col_is_fk('public', 'yield_entries', 'task_id', 'Yield Task link is a foreign key');
select col_is_unique('public', 'yield_entries', 'task_id', 'one Yield is allowed per linked Task');
select ok((select relrowsecurity from pg_class where oid = 'public.yield_entries'::regclass), 'Yield RLS remains enabled');

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
  ('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000001','authenticated','authenticated','milk-steward@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false),
  ('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000002','authenticated','authenticated','milk-hand@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false),
  ('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000003','authenticated','authenticated','milk-guest@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false),
  ('00000000-0000-0000-0000-000000000000','92000000-0000-0000-0000-000000000001','authenticated','authenticated','other-steward@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false);

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
select public.create_homestead('Milk Link A') as homestead_a \gset
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','92000000-0000-0000-0000-000000000001',true);
select public.create_homestead('Milk Link B') as homestead_b \gset
reset role;

insert into public.homestead_members (id,homestead_id,user_id,role,status,joined_at) values
  ('93000000-0000-0000-0000-000000000002',:'homestead_a','91000000-0000-0000-0000-000000000002','hand','active',now()),
  ('93000000-0000-0000-0000-000000000003',:'homestead_a','91000000-0000-0000-0000-000000000003','guest','active',now());
insert into public.records (id,homestead_id,type,name,status,identity,created_by,updated_by) values
  ('94000000-0000-0000-0000-000000000001',:'homestead_a','animal','Daisy','active','{"purpose":"Dairy"}','91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001'),
  ('94000000-0000-0000-0000-000000000002',:'homestead_a','animal','Beef Cow','active','{"purpose":"Meat"}','91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001'),
  ('94000000-0000-0000-0000-000000000003',:'homestead_b','animal','Other Dairy','active','{"purpose":"Dairy"}','92000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001');

select throws_ok(format($sql$insert into public.tasks (homestead_id,record_id,title,due_date,recurrence_rule)
  values (%L,'94000000-0000-0000-0000-000000000002','Invalid animal','2026-08-10','{"frequency":"daily","interval":1,"completionAction":"milk_morning"}')$sql$, :'homestead_a'),
  '23514', 'Milking completion actions require an active dairy Animal in this Homestead', 'milking action rejects a non-dairy Animal');
select throws_ok(format($sql$insert into public.tasks (homestead_id,record_id,title,recurrence_rule)
  values (%L,'94000000-0000-0000-0000-000000000001','Missing date','{"frequency":"daily","interval":1,"completionAction":"milk_morning"}')$sql$, :'homestead_a'),
  '23514', 'Milking completion actions require a recurring task, dairy Animal, and task date', 'milking action requires a work date');

insert into public.tasks (id,homestead_id,record_id,title,due_date,recurrence_rule,created_by,updated_by) values
  ('95000000-0000-0000-0000-000000000001',:'homestead_a','94000000-0000-0000-0000-000000000001','Barn round','2026-08-10','{"frequency":"daily","interval":1,"mode":"fixed_schedule","completionAction":"milk_morning"}','91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001'),
  ('95000000-0000-0000-0000-000000000002',:'homestead_a','94000000-0000-0000-0000-000000000001','Evening barn round','2026-08-10','{"frequency":"daily","interval":1,"mode":"fixed_schedule","completionAction":"milk_evening"}','91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001'),
  ('95000000-0000-0000-0000-000000000003',:'homestead_a','94000000-0000-0000-0000-000000000001','Assigned milking','2026-08-10','{"frequency":"daily","interval":1,"mode":"fixed_schedule","completionAction":"milk_morning"}','91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001'),
  ('95000000-0000-0000-0000-000000000004',:'homestead_a','94000000-0000-0000-0000-000000000001','Unassigned milking','2026-08-10','{"frequency":"daily","interval":1,"mode":"fixed_schedule","completionAction":"milk_evening"}','91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001');
insert into public.task_assignments (homestead_id,task_id,member_id,assigned_by) values
  (:'homestead_a','95000000-0000-0000-0000-000000000003','93000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
select is((public.apply_housekeeping_sync_operation(
  'milk-yield-first','96000000-0000-0000-0000-000000000001','yield_entries','95000000-0000-0000-0000-000000000001','create',null,'2026-08-10T11:00:00Z',
  '{"record_id":"94000000-0000-0000-0000-000000000001","task_id":"95000000-0000-0000-0000-000000000001","yield_type":"milk","occurred_at":"2026-08-10T11:00:00Z","session":"morning","quantity":2,"unit":"gal","details":{"task_id":"95000000-0000-0000-0000-000000000001"}}'
) ->> 'status'), 'applied', 'yield-first save uses the existing housekeeping sync RPC');
select is((select task_id from public.yield_entries where id='95000000-0000-0000-0000-000000000001'), '95000000-0000-0000-0000-000000000001'::uuid, 'Yield retains the explicit Task link');
select is((select status::text from public.tasks where id='95000000-0000-0000-0000-000000000001'), 'completed', 'linked Yield completes the Task');
select is((select count(*) from public.tasks where parent_task_id='95000000-0000-0000-0000-000000000001'), 1::bigint, 'completion creates exactly one next occurrence');
select is((select recurrence_rule ->> 'completionAction' from public.tasks where parent_task_id='95000000-0000-0000-0000-000000000001'), 'milk_morning', 'next occurrence keeps the completion action');
select is((select due_date from public.tasks where parent_task_id='95000000-0000-0000-0000-000000000001'), '2026-08-11'::date, 'next occurrence keeps the recurring schedule');

select public.apply_housekeeping_sync_operation(
  'milk-yield-first','96000000-0000-0000-0000-000000000001','yield_entries','95000000-0000-0000-0000-000000000001','create',null,'2026-08-10T11:00:00Z',
  '{"record_id":"94000000-0000-0000-0000-000000000001","task_id":"95000000-0000-0000-0000-000000000001","yield_type":"milk","occurred_at":"2026-08-10T11:00:00Z","session":"morning","quantity":2,"unit":"gal","details":{"task_id":"95000000-0000-0000-0000-000000000001"}}');
select is((select count(*) from public.yield_entries where task_id='95000000-0000-0000-0000-000000000001'), 1::bigint, 'operation retry leaves one Yield');
select is((select count(*) from public.tasks where parent_task_id='95000000-0000-0000-0000-000000000001'), 1::bigint, 'operation retry leaves one next Task');
select throws_ok($$select public.apply_housekeeping_sync_operation(
  'milk-duplicate','96000000-0000-0000-0000-000000000001','yield_entries','97000000-0000-0000-0000-000000000001','create',null,'2026-08-10T11:00:00Z',
  '{"record_id":"94000000-0000-0000-0000-000000000001","yield_type":"milk","occurred_at":"2026-08-10T11:00:00Z","session":"morning","quantity":2,"unit":"gal","details":{"task_id":"95000000-0000-0000-0000-000000000001"}}')$$,
  '23505', null, 'database prevents a second Yield for the same Task');
select throws_ok($$select public.apply_housekeeping_sync_operation(
  'milk-wrong-session','96000000-0000-0000-0000-000000000001','yield_entries','95000000-0000-0000-0000-000000000002','create',null,'2026-08-10T11:00:00Z',
  '{"record_id":"94000000-0000-0000-0000-000000000001","yield_type":"milk","occurred_at":"2026-08-10T11:00:00Z","session":"morning","quantity":2,"unit":"gal","details":{"task_id":"95000000-0000-0000-0000-000000000002"}}')$$,
  '23514', 'Yield does not match the linked milking Task', 'linked Yield must match the configured session');
select throws_ok($$select public.apply_housekeeping_sync_operation(
  'milk-wrong-date','96000000-0000-0000-0000-000000000001','yield_entries','97000000-0000-0000-0000-000000000002','create',null,'2026-08-11T22:00:00Z',
  '{"record_id":"94000000-0000-0000-0000-000000000001","yield_type":"milk","occurred_at":"2026-08-11T22:00:00Z","session":"evening","quantity":2,"unit":"gal","details":{"task_id":"95000000-0000-0000-0000-000000000002"}}')$$,
  '23514', 'Yield does not match the linked milking Task', 'linked Yield must match the task work date');
select throws_ok($$select public.apply_housekeeping_sync_operation(
  'milk-foreign-task','96000000-0000-0000-0000-000000000001','yield_entries','97000000-0000-0000-0000-000000000003','create',null,'2026-08-10T11:00:00Z',
  jsonb_build_object('record_id','94000000-0000-0000-0000-000000000001','yield_type','milk','occurred_at','2026-08-10T11:00:00Z','session','morning','quantity',2,'unit','gal','details',jsonb_build_object('task_id','95000000-0000-0000-0000-000000000099')))$$,
  '23503', null, 'foreign or missing Task links are rejected');

select lives_ok($$select public.soft_delete_row('yield_entries','95000000-0000-0000-0000-000000000001')$$, 'linked Yield can be soft deleted');
select is((select status::text from public.tasks where id='95000000-0000-0000-0000-000000000001'), 'completed', 'deleting a Yield never reopens the Task');
select is((select count(*) from public.tasks where parent_task_id='95000000-0000-0000-0000-000000000001'), 1::bigint, 'deleting a Yield does not alter recurrence');

select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000002',true);
select is((public.apply_housekeeping_sync_operation(
  'hand-linked-yield','96000000-0000-0000-0000-000000000002','yield_entries','95000000-0000-0000-0000-000000000003','create',null,'2026-08-10T11:00:00Z',
  '{"record_id":"94000000-0000-0000-0000-000000000001","yield_type":"milk","occurred_at":"2026-08-10T11:00:00Z","session":"morning","quantity":1.5,"unit":"gal","details":{"task_id":"95000000-0000-0000-0000-000000000003"}}') ->> 'status'), 'applied', 'assigned Hand can record Yield and complete the Task');
select throws_ok($$select public.apply_housekeeping_sync_operation(
  'hand-unassigned-yield','96000000-0000-0000-0000-000000000002','yield_entries','95000000-0000-0000-0000-000000000004','create',null,'2026-08-10T22:00:00Z',
  '{"record_id":"94000000-0000-0000-0000-000000000001","yield_type":"milk","occurred_at":"2026-08-10T22:00:00Z","session":"evening","quantity":1.5,"unit":"gal","details":{"task_id":"95000000-0000-0000-0000-000000000004"}}')$$,
  '42501', 'Task is not assigned to this member', 'Hand cannot complete an unassigned milking Task through Yield');
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.apply_housekeeping_sync_operation(
  'guest-linked-yield','96000000-0000-0000-0000-000000000003','yield_entries','97000000-0000-0000-0000-000000000004','create',null,'2026-08-10T22:00:00Z',
  '{"record_id":"94000000-0000-0000-0000-000000000001","yield_type":"milk","occurred_at":"2026-08-10T22:00:00Z","session":"evening","quantity":1,"unit":"gal","details":{"task_id":"95000000-0000-0000-0000-000000000004"}}')$$,
  '42501', 'Not authorized', 'Guest cannot record a linked Yield');
reset role;

select is((select count(*) from information_schema.role_table_grants where grantee='anon' and table_schema='public' and table_name='yield_entries'), 0::bigint, 'anonymous receives no Yield grants');

select * from finish();
rollback;
