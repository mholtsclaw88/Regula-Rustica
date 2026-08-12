begin;

create extension if not exists pgtap with schema extensions;
select plan(29);

select has_index('public', 'record_relationships', 'record_relationships_one_current_location_idx', 'one canonical current location index exists');
select has_index('public', 'record_relationships', 'record_relationships_one_parent_role_idx', 'one Dam or Sire relationship index exists');
select has_index('public', 'tasks', 'tasks_one_active_routine_per_animal', 'one active canonical Routine index remains available');

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-000000000001','authenticated','authenticated','records-a@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false),
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-000000000002','authenticated','authenticated','records-b@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false);

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000001',true);
select public.create_homestead('Records A') as homestead_a \gset
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000002',true);
select public.create_homestead('Records B') as homestead_b \gset
reset role;

select set_config('regula.test_homestead_a', :'homestead_a', true);
select set_config('regula.test_homestead_b', :'homestead_b', true);

insert into public.records (id,homestead_id,type,name,status,identity,created_by,updated_by) values
  ('a2000000-0000-0000-0000-000000000001',current_setting('regula.test_homestead_a')::uuid,'animal','Maple','active','{"managedAs":"Individual","purpose":"Dairy","species":"Cattle"}','a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000002',current_setting('regula.test_homestead_a')::uuid,'animal','Dam','active','{"managedAs":"Individual"}','a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000003',current_setting('regula.test_homestead_a')::uuid,'animal','Sire','active','{"managedAs":"Individual"}','a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000004',current_setting('regula.test_homestead_a')::uuid,'animal','Feeder pigs','active','{"managedAs":"Group"}','a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000005',current_setting('regula.test_homestead_a')::uuid,'land','North Paddock','active','{"landType":"Pasture"}','a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000006',current_setting('regula.test_homestead_a')::uuid,'structure','Main Barn','active','{}','a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000007',current_setting('regula.test_homestead_a')::uuid,'equipment','Ford 8N','active','{}','a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000008',current_setting('regula.test_homestead_a')::uuid,'work','Repair roof','active','{}','a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000009',current_setting('regula.test_homestead_b')::uuid,'land','Foreign Land','active','{}','a1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000002');

select lives_ok($$insert into public.record_relationships (id,homestead_id,source_record_id,target_record_id,relationship_type,details)
  values ('a3000000-0000-0000-0000-000000000001',current_setting('regula.test_homestead_a')::uuid,'a2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000005','located_on','{}')$$, 'Animal may be located on Land');
select is((select details ->> 'purpose' from public.record_relationships where id='a3000000-0000-0000-0000-000000000001'), 'current_location', 'location relationship is marked canonical');
select throws_ok($$insert into public.record_relationships (homestead_id,source_record_id,target_record_id,relationship_type)
  values (current_setting('regula.test_homestead_a')::uuid,'a2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000006','located_on')$$,
  '23505', null, 'Animal cannot have two active current locations');
update public.record_relationships set ended_at=now() where id='a3000000-0000-0000-0000-000000000001';
select lives_ok($$insert into public.record_relationships (id,homestead_id,source_record_id,target_record_id,relationship_type)
  values ('a3000000-0000-0000-0000-000000000002',current_setting('regula.test_homestead_a')::uuid,'a2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000006','located_on')$$, 'changing location preserves the ended relationship and adds the replacement');
select is((select count(*) from public.record_relationships where target_record_id='a2000000-0000-0000-0000-000000000006' and relationship_type='located_on' and ended_at is null), 1::bigint, 'reverse Structure occupants derive from active locations');
select lives_ok($$insert into public.record_relationships (homestead_id,source_record_id,target_record_id,relationship_type)
  values (current_setting('regula.test_homestead_a')::uuid,'a2000000-0000-0000-0000-000000000007','a2000000-0000-0000-0000-000000000005','located_on')$$, 'Equipment may be located on Land');
select throws_ok($$insert into public.record_relationships (homestead_id,source_record_id,target_record_id,relationship_type)
  values (current_setting('regula.test_homestead_a')::uuid,'a2000000-0000-0000-0000-000000000006','a2000000-0000-0000-0000-000000000005','located_on')$$,
  '23514', 'Current location supports Animal or Equipment to Land or Structure', 'Structure to Land current location is rejected');
select throws_ok($$insert into public.record_relationships (homestead_id,source_record_id,target_record_id,relationship_type)
  values (current_setting('regula.test_homestead_a')::uuid,'a2000000-0000-0000-0000-000000000007','a2000000-0000-0000-0000-000000000009','located_on')$$,
  '23503', 'Relationship records must belong to this Homestead', 'cross-Homestead current location is rejected');

select lives_ok($$insert into public.record_relationships (id,homestead_id,source_record_id,target_record_id,relationship_type,details)
  values ('a3000000-0000-0000-0000-000000000010',current_setting('regula.test_homestead_a')::uuid,'a2000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000001','parent_of','{"parentRole":"dam"}')$$, 'Dam relationship is accepted');
select lives_ok($$insert into public.record_relationships (id,homestead_id,source_record_id,target_record_id,relationship_type,details)
  values ('a3000000-0000-0000-0000-000000000011',current_setting('regula.test_homestead_a')::uuid,'a2000000-0000-0000-0000-000000000003','a2000000-0000-0000-0000-000000000001','parent_of','{"parentRole":"sire"}')$$, 'Sire relationship is accepted');
select is((select count(*) from public.record_relationships where source_record_id='a2000000-0000-0000-0000-000000000002' and relationship_type='parent_of'), 1::bigint, 'reverse offspring derives from parent relationships');
select throws_ok($$insert into public.record_relationships (homestead_id,source_record_id,target_record_id,relationship_type,details)
  values (current_setting('regula.test_homestead_a')::uuid,'a2000000-0000-0000-0000-000000000003','a2000000-0000-0000-0000-000000000001','parent_of','{"parentRole":"dam"}')$$,
  '23505', null, 'only one active Dam is allowed');
select throws_ok($$insert into public.record_relationships (homestead_id,source_record_id,target_record_id,relationship_type,details)
  values (current_setting('regula.test_homestead_a')::uuid,'a2000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000004','parent_of','{"parentRole":"dam"}')$$,
  '23514', 'Parentage requires individual Animals and a Dam or Sire role', 'Group Animals reject parentage');

select lives_ok($$insert into public.tasks (id,homestead_id,record_id,title,due_date,recurrence_rule,created_by,updated_by)
  values ('a4000000-0000-0000-0000-000000000001',current_setting('regula.test_homestead_a')::uuid,'a2000000-0000-0000-0000-000000000001','General Health Check','2026-08-12','{"frequency":"weekly","interval":1,"routineType":"animal_health_check"}','a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001')$$, 'suggested Animal Routine uses recurring Tasks');
select throws_ok($$insert into public.tasks (homestead_id,record_id,title,due_date,recurrence_rule)
  values (current_setting('regula.test_homestead_a')::uuid,'a2000000-0000-0000-0000-000000000008','General Health Check','2026-08-12','{"frequency":"weekly","interval":1,"routineType":"animal_health_check"}')$$,
  '23514', 'Animal care Routine requires an Animal', 'Work rejects Animal Routine templates');
select throws_ok($$insert into public.tasks (homestead_id,record_id,title,due_date,recurrence_rule)
  values (current_setting('regula.test_homestead_a')::uuid,'a2000000-0000-0000-0000-000000000001','Renamed title','2026-08-13','{"frequency":"weekly","interval":2,"routineType":"animal_health_check"}')$$,
  '23505', null, 'one active canonical Routine type is allowed per Record');
select lives_ok($$insert into public.tasks (homestead_id,record_id,title,due_date,recurrence_rule)
  values (current_setting('regula.test_homestead_a')::uuid,'a2000000-0000-0000-0000-000000000001','Arbitrary recurring Task','2026-08-13','{"frequency":"weekly","interval":1}')$$, 'ordinary recurring Tasks remain unaffected');

insert into public.homestead_people (id,homestead_id,person_type,display_name,created_by,updated_by)
values ('a5000000-0000-0000-0000-000000000001',current_setting('regula.test_homestead_a')::uuid,'child','Clare','a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001');
insert into public.homestead_people (id,homestead_id,person_type,display_name,created_by,updated_by)
values ('a5000000-0000-0000-0000-000000000002',current_setting('regula.test_homestead_b')::uuid,'child','Other Homestead Child','a1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000002');
select lives_ok($$update public.records set stewardship='{"responsiblePersonId":"a5000000-0000-0000-0000-000000000001"}' where id='a2000000-0000-0000-0000-000000000001'$$,
  'a Record may reference an active Person in its Homestead');
select throws_ok($$update public.records set stewardship='{"responsiblePersonId":"a5000000-0000-0000-0000-000000000002"}' where id='a2000000-0000-0000-0000-000000000001'$$,
  '23514', 'Responsible Person must be active in this Homestead', 'cross-Homestead responsibility is rejected');
select throws_ok($$update public.records set stewardship='{"responsiblePersonId":"legacy-name"}' where id='a2000000-0000-0000-0000-000000000001'$$,
  '23514', 'Responsible Person must use a stable Person identifier', 'free-text responsibility is not accepted as a canonical Person link');
insert into public.task_assignments (homestead_id,task_id,person_id,assigned_by)
values (current_setting('regula.test_homestead_a')::uuid,'a4000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.complete_recurring_task('a4000000-0000-0000-0000-000000000001','records-v2-complete','a6000000-0000-0000-0000-000000000001')$$, 'completing a suggested Routine creates only its next occurrence');
select is((select count(*) from public.tasks where parent_task_id='a4000000-0000-0000-0000-000000000001'), 1::bigint, 'suggested Routine completion is idempotent by occurrence');
select is((select count(*) from public.task_assignments a join public.tasks t on t.id=a.task_id where t.parent_task_id='a4000000-0000-0000-0000-000000000001' and a.person_id='a5000000-0000-0000-0000-000000000001' and a.removed_at is null), 1::bigint, 'next Routine occurrence retains its assignee');
select is((select count(*) from public.record_relationships), 5::bigint, 'RLS exposes only this Homestead relationship history');
reset role;

select ok((select relrowsecurity from pg_class where oid='public.record_relationships'::regclass), 'relationship RLS remains enabled');
select is((select count(*) from information_schema.role_table_grants where grantee='anon' and table_schema='public' and table_name='record_relationships'), 0::bigint, 'anonymous receives no relationship grants');

select * from finish();
rollback;
