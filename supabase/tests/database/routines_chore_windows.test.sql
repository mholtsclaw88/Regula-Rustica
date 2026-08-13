begin;

create extension if not exists pgtap with schema extensions;
select plan(35);

select has_table('public','chore_windows','Chore Windows are first-class');
select has_table('public','routines','Routine definitions are first-class');
select has_table('public','routine_occurrences','Routine occurrences are first-class');
select has_column('public','yield_entries','routine_occurrence_id','Yield links to a Routine occurrence');
select has_function('public','apply_routine_sync_operation',array['text','uuid','text','uuid','text','integer','timestamp with time zone','jsonb'],'Routine sync RPC exists');
select ok((select relrowsecurity from pg_class where oid='public.chore_windows'::regclass),'Chore Window RLS is enabled');
select ok((select relrowsecurity from pg_class where oid='public.routines'::regclass),'Routine RLS is enabled');
select ok((select relrowsecurity from pg_class where oid='public.routine_occurrences'::regclass),'Occurrence RLS is enabled');
select is((select count(*) from information_schema.role_table_grants where grantee='anon' and table_schema='public' and table_name in ('chore_windows','routines','routine_occurrences')),0::bigint,'anonymous receives no Routine grants');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-000000000001','authenticated','authenticated','routine-steward-a@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-000000000002','authenticated','authenticated','routine-keeper@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-000000000003','authenticated','authenticated','routine-hand@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-000000000004','authenticated','authenticated','routine-guest@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','a2000000-0000-0000-0000-000000000001','authenticated','authenticated','routine-steward-b@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false);

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000001',true);
select public.create_homestead('Routine A') as homestead_a \gset
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','a2000000-0000-0000-0000-000000000001',true);
select public.create_homestead('Routine B') as homestead_b \gset
reset role;

insert into public.homestead_members(id,homestead_id,user_id,role,status,joined_at) values
('a3000000-0000-0000-0000-000000000002',:'homestead_a','a1000000-0000-0000-0000-000000000002','keeper','active',now()),
('a3000000-0000-0000-0000-000000000003',:'homestead_a','a1000000-0000-0000-0000-000000000003','hand','active',now()),
('a3000000-0000-0000-0000-000000000004',:'homestead_a','a1000000-0000-0000-0000-000000000004','guest','active',now());
insert into public.records(id,homestead_id,type,name,status,identity,created_by,updated_by) values
('a4000000-0000-0000-0000-000000000001',:'homestead_a','animal','Daisy','active','{"purpose":"Dairy"}','a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001'),
('a4000000-0000-0000-0000-000000000002',:'homestead_a','animal','Layers','active','{"purpose":"Eggs"}','a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001'),
('a4000000-0000-0000-0000-000000000099',:'homestead_b','animal','Foreign Cow','active','{"purpose":"Dairy"}','a2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001');

select is((select count(*) from public.chore_windows where homestead_id=:'homestead_a'),2::bigint,'new Homestead receives two default Chore Windows');

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000001',true);
select public.apply_routine_sync_operation('routine-create','a5000000-0000-0000-0000-000000000001','routines','a6000000-0000-0000-0000-000000000001','create',null,'2026-08-12T12:00:00Z',
jsonb_build_object('record_id','a4000000-0000-0000-0000-000000000001','chore_window_id',(select id from public.chore_windows where system_key='morning'),'person_id',(select id from public.homestead_people where member_id='a3000000-0000-0000-0000-000000000003'),'name','Morning Milking','routine_type','milk_morning','enabled',true,'frequency','daily','interval',1,'first_date','2026-08-12','next_date','2026-08-12')) as routine_created \gset
select is((:'routine_created'::jsonb->>'status'),'applied','Steward creates a Routine through sync');
select is((select homestead_id from public.routines where id='a6000000-0000-0000-0000-000000000001'),:'homestead_a'::uuid,'Routine Homestead is server-derived');
select public.apply_routine_sync_operation('routine-create','a5000000-0000-0000-0000-000000000001','routines','a6000000-0000-0000-0000-000000000001','create',null,'2026-08-12T12:00:00Z',
jsonb_build_object('record_id','a4000000-0000-0000-0000-000000000001','chore_window_id',(select id from public.chore_windows where system_key='morning'),'person_id',(select id from public.homestead_people where member_id='a3000000-0000-0000-0000-000000000003'),'name','Morning Milking','routine_type','milk_morning','enabled',true,'frequency','daily','interval',1,'first_date','2026-08-12','next_date','2026-08-12'));
select is((select count(*) from public.routines where id='a6000000-0000-0000-0000-000000000001'),1::bigint,'Routine creation is idempotent');
select is((select count(*) from public.sync_operations where idempotency_key='routine-create'),1::bigint,'Routine retry records one operation');
select is((public.apply_routine_sync_operation('occurrence-create','a5000000-0000-0000-0000-000000000001','routine_occurrences','a7000000-0000-0000-0000-000000000001','create',null,'2026-08-12T12:00:00Z','{"routine_id":"a6000000-0000-0000-0000-000000000001","occurrence_date":"2026-08-12","status":"pending"}') ->> 'status'),'applied','Steward creates the dated occurrence');
select is((public.apply_routine_sync_operation('occurrence-complete','a5000000-0000-0000-0000-000000000001','routine_occurrences','a7000000-0000-0000-0000-000000000001','update',1,'2026-08-12T13:00:00Z','{"routine_id":"a6000000-0000-0000-0000-000000000001","occurrence_date":"2026-08-12","status":"completed","completion_method":"ordinary","completed_at":"2026-08-12T13:00:00Z"}') ->> 'status'),'applied','Steward completes an occurrence');
select is((select status from public.routine_occurrences where id='a7000000-0000-0000-0000-000000000001'),'completed','Occurrence stores completion state');
select is((select count(*) from public.routine_occurrences where routine_id='a6000000-0000-0000-0000-000000000001' and occurrence_date='2026-08-13'),1::bigint,'completion generates exactly one next occurrence');
select is((select next_date from public.routines where id='a6000000-0000-0000-0000-000000000001'),'2026-08-13'::date,'definition advances to the next date');
select public.apply_routine_sync_operation('occurrence-complete','a5000000-0000-0000-0000-000000000001','routine_occurrences','a7000000-0000-0000-0000-000000000001','update',1,'2026-08-12T13:00:00Z','{"routine_id":"a6000000-0000-0000-0000-000000000001","occurrence_date":"2026-08-12","status":"completed","completion_method":"ordinary","completed_at":"2026-08-12T13:00:00Z"}');
select is((select count(*) from public.routine_occurrences where routine_id='a6000000-0000-0000-0000-000000000001' and occurrence_date='2026-08-13'),1::bigint,'completion retry never duplicates the next occurrence');
select is((select count(*) from public.routines),1::bigint,'Steward sees only its Homestead Routines');

select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000004',true);
select is((select count(*) from public.routines),1::bigint,'Guest may read Homestead Routines');
select throws_ok($$select public.apply_routine_sync_operation('guest-edit','a5000000-0000-0000-0000-000000000004','routines','a6000000-0000-0000-0000-000000000001','update',2,now(),'{}')$$,'42501','Not authorized','Guest cannot edit a Routine');

select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000002',true);
select is((public.apply_routine_sync_operation('keeper-window','a5000000-0000-0000-0000-000000000002','chore_windows','a8000000-0000-0000-0000-000000000001','create',null,now(),'{"name":"Midday","display_order":15,"enabled":true,"daypart":"other"}') ->> 'status'),'applied','Keeper may create a Chore Window');

select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000003',true);
select is((public.apply_routine_sync_operation('hand-complete','a5000000-0000-0000-0000-000000000003','routine_occurrences',(select id from public.routine_occurrences where routine_id='a6000000-0000-0000-0000-000000000001' and occurrence_date='2026-08-13'),'update',1,now(),'{"routine_id":"a6000000-0000-0000-0000-000000000001","occurrence_date":"2026-08-13","status":"completed","completion_method":"ordinary","completed_at":"2026-08-13T13:00:00Z"}') ->> 'status'),'applied','assigned Hand may complete a Routine occurrence');

select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000001',true);
select public.apply_routine_sync_operation('egg-routine','a5000000-0000-0000-0000-000000000001','routines','a6000000-0000-0000-0000-000000000002','create',null,now(),jsonb_build_object('record_id','a4000000-0000-0000-0000-000000000002','chore_window_id',(select id from public.chore_windows where system_key='morning'),'name','Egg Collection','routine_type','egg_collection','enabled',true,'frequency','daily','interval',1,'first_date','2026-08-12','next_date','2026-08-12'));
select public.apply_routine_sync_operation('egg-occurrence','a5000000-0000-0000-0000-000000000001','routine_occurrences','a7000000-0000-0000-0000-000000000002','create',null,now(),'{"routine_id":"a6000000-0000-0000-0000-000000000002","occurrence_date":"2026-08-12","status":"pending"}');
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.apply_routine_sync_operation('hand-unassigned','a5000000-0000-0000-0000-000000000003','routine_occurrences','a7000000-0000-0000-0000-000000000002','update',1,now(),'{"routine_id":"a6000000-0000-0000-0000-000000000002","occurrence_date":"2026-08-12","status":"completed","completion_method":"ordinary","completed_at":"2026-08-12T13:00:00Z"}')$$,'42501','Not authorized','Hand cannot complete an unassigned Routine');
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000001',true);
select is((public.apply_housekeeping_sync_operation('egg-yield','a5000000-0000-0000-0000-000000000001','yield_entries','a9000000-0000-0000-0000-000000000001','create',null,'2026-08-12T16:00:00Z','{"record_id":"a4000000-0000-0000-0000-000000000002","yield_type":"eggs","occurred_at":"2026-08-12T16:00:00Z","session":"other","quantity":8,"unit":"eggs","details":{"routine_occurrence_id":"a7000000-0000-0000-0000-000000000002"}}') ->> 'status'),'applied','Yield records through the existing sync RPC');
select is((select routine_occurrence_id from public.yield_entries where id='a9000000-0000-0000-0000-000000000001'),'a7000000-0000-0000-0000-000000000002'::uuid,'Yield retains its occurrence link');
select is((select status from public.routine_occurrences where id='a7000000-0000-0000-0000-000000000002'),'completed','Yield completes its occurrence');
select is((select count(*) from public.tasks where parent_task_id is not null),0::bigint,'first-class Routine completion creates no Task recurrence');
select is((select count(*) from public.yield_entries where routine_occurrence_id='a7000000-0000-0000-0000-000000000002'),1::bigint,'one Yield is stored for the occurrence');
select lives_ok($$select public.soft_delete_row('routines','a6000000-0000-0000-0000-000000000002')$$,'Routine can be soft deleted');
select ok((select deleted_at is not null from public.routines where id='a6000000-0000-0000-0000-000000000002'),'Routine receives a deletion timestamp');
select ok(exists(select 1 from public.audit_entries where row_id='a6000000-0000-0000-0000-000000000002' and action='soft_delete'),'Routine soft deletion is audited');
select ok((select count(*)=3 from pg_class where oid in ('public.chore_windows'::regclass,'public.routines'::regclass,'public.routine_occurrences'::regclass) and relrowsecurity),'RLS remains enabled on every new exposed table');
reset role;

select * from finish();
rollback;
