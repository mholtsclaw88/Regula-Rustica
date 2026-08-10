begin;

create extension if not exists pgtap with schema extensions;
select plan(39);

select has_table('public', 'calendar_events', 'calendar events table exists');
select has_table('public', 'yield_entries', 'yield entries table exists');
select has_column('public', 'tasks', 'available_from', 'tasks retain an available date');
select has_column('public', 'tasks', 'due_date', 'tasks retain a due date');
select has_function('public', 'apply_housekeeping_sync_operation', array['text','uuid','text','uuid','text','integer','timestamp with time zone','jsonb'], 'housekeeping sync RPC exists');
select ok((select relrowsecurity from pg_class where oid = 'public.calendar_events'::regclass), 'calendar events have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.yield_entries'::regclass), 'yield entries have RLS enabled');

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
  ('00000000-0000-0000-0000-000000000000','81000000-0000-0000-0000-000000000001','authenticated','authenticated','house-steward-a@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false),
  ('00000000-0000-0000-0000-000000000000','81000000-0000-0000-0000-000000000002','authenticated','authenticated','house-keeper-a@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false),
  ('00000000-0000-0000-0000-000000000000','81000000-0000-0000-0000-000000000003','authenticated','authenticated','house-hand-a@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false),
  ('00000000-0000-0000-0000-000000000000','81000000-0000-0000-0000-000000000004','authenticated','authenticated','house-guest-a@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false),
  ('00000000-0000-0000-0000-000000000000','82000000-0000-0000-0000-000000000001','authenticated','authenticated','house-steward-b@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false);

set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
select public.create_homestead('Housekeeping A') as homestead_a \gset
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','82000000-0000-0000-0000-000000000001',true);
select public.create_homestead('Housekeeping B') as homestead_b \gset
reset role;

insert into public.homestead_members (homestead_id,user_id,role,status,joined_at) values
  (:'homestead_a','81000000-0000-0000-0000-000000000002','keeper','active',now()),
  (:'homestead_a','81000000-0000-0000-0000-000000000003','hand','active',now()),
  (:'homestead_a','81000000-0000-0000-0000-000000000004','guest','active',now());
insert into public.records (id,homestead_id,type,name,status,created_by,updated_by) values
  ('83000000-0000-0000-0000-000000000001',:'homestead_a','animal','A Dairy Cow','active','81000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001'),
  ('83000000-0000-0000-0000-000000000002',:'homestead_b','animal','B Hen','active','82000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001');
insert into public.calendar_events (id,homestead_id,title,start_date,end_date,created_by,updated_by) values
  ('84000000-0000-0000-0000-000000000099',:'homestead_b','B Event','2026-08-10','2026-08-10','82000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001');
insert into public.yield_entries (id,homestead_id,record_id,yield_type,occurred_at,session,quantity,unit,created_by,updated_by) values
  ('85000000-0000-0000-0000-000000000099',:'homestead_b','83000000-0000-0000-0000-000000000002','eggs','2026-08-10T12:00:00Z','morning',6,'eggs','82000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
select public.apply_housekeeping_sync_operation(
  'calendar-create-1','86000000-0000-0000-0000-000000000001','calendar_events','84000000-0000-0000-0000-000000000001','create',null,'2026-08-10T12:00:00Z',
  jsonb_build_object('id','84000000-0000-0000-0000-000000000001','homestead_id',:'homestead_b','record_id','83000000-0000-0000-0000-000000000001','title','Vet visit','start_date','2026-08-12','end_date','2026-08-12','all_day',false,'start_time','09:00','end_time','10:00','location','Barn')
) as calendar_created \gset
select is((:'calendar_created'::jsonb ->> 'status'), 'applied', 'Steward can sync a calendar event');
select is((select homestead_id from public.calendar_events where id='84000000-0000-0000-0000-000000000001'), :'homestead_a'::uuid, 'calendar sync derives its Homestead');

select public.apply_housekeeping_sync_operation(
  'yield-create-1','86000000-0000-0000-0000-000000000001','yield_entries','85000000-0000-0000-0000-000000000001','create',null,'2026-08-10T12:00:00Z',
  jsonb_build_object('id','85000000-0000-0000-0000-000000000001','homestead_id',:'homestead_b','record_id','83000000-0000-0000-0000-000000000001','yield_type','milk','occurred_at','2026-08-10T11:30:00Z','session','morning','quantity',2.5,'unit','gal','unusable_quantity',0.25,'details',jsonb_build_object('text','Fresh'))
) as yield_created \gset
select is((:'yield_created'::jsonb ->> 'status'), 'applied', 'Steward can sync a yield entry');
select is((select homestead_id from public.yield_entries where id='85000000-0000-0000-0000-000000000001'), :'homestead_a'::uuid, 'yield sync derives its Homestead');
select is((select session from public.yield_entries where id='85000000-0000-0000-0000-000000000001'), 'morning', 'yield session is retained');

select public.apply_housekeeping_sync_operation(
  'yield-create-1','86000000-0000-0000-0000-000000000001','yield_entries','85000000-0000-0000-0000-000000000001','create',null,'2026-08-10T12:00:00Z',
  jsonb_build_object('id','85000000-0000-0000-0000-000000000001','homestead_id',:'homestead_b','record_id','83000000-0000-0000-0000-000000000001','yield_type','milk','occurred_at','2026-08-10T11:30:00Z','session','morning','quantity',2.5,'unit','gal','unusable_quantity',0.25,'details',jsonb_build_object('text','Fresh'))
);
select is((select count(*) from public.yield_entries where id='85000000-0000-0000-0000-000000000001'), 1::bigint, 'yield retry does not duplicate an entry');
select is((select count(*) from public.sync_operations where idempotency_key='yield-create-1'), 1::bigint, 'yield retry records one operation');

select public.apply_housekeeping_sync_operation(
  'yield-update-1','86000000-0000-0000-0000-000000000001','yield_entries','85000000-0000-0000-0000-000000000001','update',1,'2026-08-10T13:00:00Z',
  '{"record_id":"83000000-0000-0000-0000-000000000001","yield_type":"milk","occurred_at":"2026-08-10T11:30:00Z","session":"morning","quantity":3,"unit":"gal","unusable_quantity":0,"details":{}}'
) as yield_updated \gset
select is((:'yield_updated'::jsonb ->> 'status'), 'applied', 'same-version yield update succeeds');
select is((select version from public.yield_entries where id='85000000-0000-0000-0000-000000000001'), 2, 'yield update increments its version');
select lives_ok($$select public.soft_delete_row('yield_entries','85000000-0000-0000-0000-000000000001')$$, 'yield soft deletion succeeds');
select ok((select deleted_at is not null from public.yield_entries where id='85000000-0000-0000-0000-000000000001'), 'yield receives a deletion timestamp');
select lives_ok($$select public.restore_row('yield_entries','85000000-0000-0000-0000-000000000001')$$, 'yield restoration succeeds');
select ok((select deleted_at is null from public.yield_entries where id='85000000-0000-0000-0000-000000000001'), 'yield is restored');
select ok(exists(select 1 from public.audit_entries where row_id='85000000-0000-0000-0000-000000000001' and action='soft_delete') and exists(select 1 from public.audit_entries where row_id='85000000-0000-0000-0000-000000000001' and action='restore'), 'yield deletion and restoration are audited');

select is((select count(*) from public.calendar_events), 1::bigint, 'Steward sees only its Homestead calendar events');
select is((select count(*) from public.yield_entries), 1::bigint, 'Steward sees only its Homestead yield entries');
select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000004',true);
select is((select count(*) from public.calendar_events), 1::bigint, 'Guest may read its Homestead calendar');
select is((select count(*) from public.yield_entries), 1::bigint, 'Guest may read its Homestead yield');
select throws_ok($$select public.apply_housekeeping_sync_operation('guest-calendar','86000000-0000-0000-0000-000000000004','calendar_events','84000000-0000-0000-0000-000000000004','create',null,now(),'{"title":"Denied","start_date":"2026-08-12","end_date":"2026-08-12"}')$$, '42501', 'Not authorized', 'Guest cannot create calendar events');
select throws_ok($$select public.apply_housekeeping_sync_operation('guest-yield','86000000-0000-0000-0000-000000000004','yield_entries','85000000-0000-0000-0000-000000000004','create',null,now(),'{"record_id":"83000000-0000-0000-0000-000000000001","yield_type":"eggs","occurred_at":"2026-08-10T12:00:00Z","session":"other","quantity":1,"unit":"eggs"}')$$, '42501', 'Not authorized', 'Guest cannot create yield');

select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.apply_housekeeping_sync_operation('hand-calendar','86000000-0000-0000-0000-000000000003','calendar_events','84000000-0000-0000-0000-000000000003','create',null,now(),'{"title":"Denied","start_date":"2026-08-12","end_date":"2026-08-12"}')$$, '42501', 'Not authorized', 'Hand cannot create calendar events');
select is((public.apply_housekeeping_sync_operation('hand-yield','86000000-0000-0000-0000-000000000003','yield_entries','85000000-0000-0000-0000-000000000003','create',null,now(),'{"record_id":"83000000-0000-0000-0000-000000000001","yield_type":"eggs","occurred_at":"2026-08-10T12:00:00Z","session":"other","quantity":8,"unit":"eggs"}') ->> 'status'), 'applied', 'Hand may record ordinary yield');
select throws_ok($$select public.apply_housekeeping_sync_operation('hand-yield-edit','86000000-0000-0000-0000-000000000003','yield_entries','85000000-0000-0000-0000-000000000003','update',1,now(),'{"record_id":"83000000-0000-0000-0000-000000000001","yield_type":"eggs","occurred_at":"2026-08-10T12:00:00Z","session":"other","quantity":9,"unit":"eggs"}')$$, '42501', 'Not authorized', 'Hand cannot rewrite historical yield');

select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000002',true);
select is((public.apply_housekeeping_sync_operation('keeper-calendar','86000000-0000-0000-0000-000000000002','calendar_events','84000000-0000-0000-0000-000000000002','create',null,now(),'{"title":"Seed pickup","start_date":"2026-08-13","end_date":"2026-08-13"}') ->> 'status'), 'applied', 'Keeper may create calendar events');
select is((public.apply_housekeeping_sync_operation('keeper-yield','86000000-0000-0000-0000-000000000002','yield_entries','85000000-0000-0000-0000-000000000002','create',null,now(),'{"record_id":"83000000-0000-0000-0000-000000000001","yield_type":"milk","occurred_at":"2026-08-10T22:00:00Z","session":"evening","quantity":2,"unit":"gal"}') ->> 'status'), 'applied', 'Keeper may create yield');

select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.apply_housekeeping_sync_operation('foreign-calendar-link','86000000-0000-0000-0000-000000000001','calendar_events','84000000-0000-0000-0000-000000000005','create',null,now(),'{"record_id":"83000000-0000-0000-0000-000000000002","title":"Foreign","start_date":"2026-08-12","end_date":"2026-08-12"}')$$, '23503', 'Record belongs to another Homestead', 'calendar cannot link another Homestead record');
select throws_ok($$select public.apply_housekeeping_sync_operation('foreign-yield-link','86000000-0000-0000-0000-000000000001','yield_entries','85000000-0000-0000-0000-000000000005','create',null,now(),'{"record_id":"83000000-0000-0000-0000-000000000002","yield_type":"eggs","occurred_at":"2026-08-10T12:00:00Z","session":"other","quantity":1,"unit":"eggs"}')$$, '23503', 'Record belongs to another Homestead', 'yield cannot link another Homestead record');
reset role;

select throws_like(format($sql$insert into public.tasks (homestead_id,title,available_from,due_date) values (%L,'Invalid window','2026-08-12','2026-08-11')$sql$, :'homestead_a'), '%violates check constraint%', 'task due date cannot precede available date');
select throws_like(format($sql$insert into public.calendar_events (homestead_id,title,start_date,end_date) values (%L,'Invalid range','2026-08-12','2026-08-11')$sql$, :'homestead_a'), '%violates check constraint%', 'calendar end date cannot precede start date');
select throws_like(format($sql$insert into public.yield_entries (homestead_id,record_id,yield_type,occurred_at,quantity,unit,unusable_quantity) values (%L,'83000000-0000-0000-0000-000000000001','milk',now(),1,'gal',2)$sql$, :'homestead_a'), '%violates check constraint%', 'unusable yield cannot exceed total quantity');
select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname in ('homesteads','profiles','homestead_members','invitations','records','record_relationships','tasks','task_assignments','chronicle_entries','notes','ledger_entries','audit_entries','sync_operations','calendar_events','yield_entries') and not c.relrowsecurity), 0::bigint, 'RLS is enabled on every exposed application table');
select is((select count(*) from information_schema.role_table_grants where grantee='anon' and table_schema='public' and table_name in ('calendar_events','yield_entries')), 0::bigint, 'anonymous receives no housekeeping table grants');

select * from finish();
rollback;
