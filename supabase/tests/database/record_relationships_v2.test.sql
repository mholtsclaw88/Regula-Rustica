begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

select has_index('public', 'record_relationships', 'record_relationships_one_current_location_idx', 'one canonical current location index exists');
select has_index('public', 'record_relationships', 'record_relationships_one_parent_role_idx', 'one Dam or Sire relationship index exists');

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
  ('00000000-0000-0000-0000-000000000000','b7000000-0000-0000-0000-000000000001','authenticated','authenticated','relationships-a@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false),
  ('00000000-0000-0000-0000-000000000000','b7000000-0000-0000-0000-000000000002','authenticated','authenticated','relationships-b@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false);

set local role authenticated;
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000001',true);
select public.create_homestead('Relationships A') as homestead_a \gset
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000002',true);
select public.create_homestead('Relationships B') as homestead_b \gset
reset role;

select set_config('regula.relationships_a', :'homestead_a', true);
select set_config('regula.relationships_b', :'homestead_b', true);

insert into public.records (id,homestead_id,type,name,status,identity,created_by,updated_by) values
  ('b7100000-0000-0000-0000-000000000001',current_setting('regula.relationships_a')::uuid,'animal','Maple','active','{"managedAs":"Individual"}','b7000000-0000-0000-0000-000000000001','b7000000-0000-0000-0000-000000000001'),
  ('b7100000-0000-0000-0000-000000000002',current_setting('regula.relationships_a')::uuid,'animal','Dam','active','{"managedAs":"Individual"}','b7000000-0000-0000-0000-000000000001','b7000000-0000-0000-0000-000000000001'),
  ('b7100000-0000-0000-0000-000000000003',current_setting('regula.relationships_a')::uuid,'animal','Sire','active','{"managedAs":"Individual"}','b7000000-0000-0000-0000-000000000001','b7000000-0000-0000-0000-000000000001'),
  ('b7100000-0000-0000-0000-000000000004',current_setting('regula.relationships_a')::uuid,'animal','Group','active','{"managedAs":"Group"}','b7000000-0000-0000-0000-000000000001','b7000000-0000-0000-0000-000000000001'),
  ('b7100000-0000-0000-0000-000000000005',current_setting('regula.relationships_a')::uuid,'land','North Paddock','active','{}','b7000000-0000-0000-0000-000000000001','b7000000-0000-0000-0000-000000000001'),
  ('b7100000-0000-0000-0000-000000000006',current_setting('regula.relationships_a')::uuid,'structure','Main Barn','active','{}','b7000000-0000-0000-0000-000000000001','b7000000-0000-0000-0000-000000000001'),
  ('b7100000-0000-0000-0000-000000000007',current_setting('regula.relationships_a')::uuid,'equipment','Tractor','active','{}','b7000000-0000-0000-0000-000000000001','b7000000-0000-0000-0000-000000000001'),
  ('b7100000-0000-0000-0000-000000000008',current_setting('regula.relationships_b')::uuid,'land','Foreign Land','active','{}','b7000000-0000-0000-0000-000000000002','b7000000-0000-0000-0000-000000000002');

select lives_ok($$insert into public.record_relationships (id,homestead_id,source_record_id,target_record_id,relationship_type,details)
  values ('b7200000-0000-0000-0000-000000000001',current_setting('regula.relationships_a')::uuid,'b7100000-0000-0000-0000-000000000001','b7100000-0000-0000-0000-000000000005','located_on','{}')$$, 'Animal may be located on Land');
select is((select details ->> 'purpose' from public.record_relationships where id='b7200000-0000-0000-0000-000000000001'), 'current_location', 'location is marked canonical');
select throws_ok($$insert into public.record_relationships (homestead_id,source_record_id,target_record_id,relationship_type)
  values (current_setting('regula.relationships_a')::uuid,'b7100000-0000-0000-0000-000000000001','b7100000-0000-0000-0000-000000000006','located_on')$$,
  '23505', null, 'Animal cannot have two active current locations');
update public.record_relationships set ended_at=now() where id='b7200000-0000-0000-0000-000000000001';
select lives_ok($$insert into public.record_relationships (homestead_id,source_record_id,target_record_id,relationship_type)
  values (current_setting('regula.relationships_a')::uuid,'b7100000-0000-0000-0000-000000000001','b7100000-0000-0000-0000-000000000006','located_on')$$, 'ended location can be replaced');
select lives_ok($$insert into public.record_relationships (homestead_id,source_record_id,target_record_id,relationship_type)
  values (current_setting('regula.relationships_a')::uuid,'b7100000-0000-0000-0000-000000000007','b7100000-0000-0000-0000-000000000005','located_on')$$, 'Equipment may be located on Land');
select throws_ok($$insert into public.record_relationships (homestead_id,source_record_id,target_record_id,relationship_type)
  values (current_setting('regula.relationships_a')::uuid,'b7100000-0000-0000-0000-000000000006','b7100000-0000-0000-0000-000000000005','located_on')$$,
  '23514', 'Current location supports Animal or Equipment to Land or Structure', 'Structure location is rejected');
select throws_ok($$insert into public.record_relationships (homestead_id,source_record_id,target_record_id,relationship_type)
  values (current_setting('regula.relationships_a')::uuid,'b7100000-0000-0000-0000-000000000007','b7100000-0000-0000-0000-000000000008','located_on')$$,
  '23503', 'Relationship records must belong to this Homestead', 'cross-Homestead location is rejected');

select lives_ok($$insert into public.record_relationships (homestead_id,source_record_id,target_record_id,relationship_type,details)
  values (current_setting('regula.relationships_a')::uuid,'b7100000-0000-0000-0000-000000000002','b7100000-0000-0000-0000-000000000001','parent_of','{"parentRole":"dam"}')$$, 'Dam relationship is accepted');
select lives_ok($$insert into public.record_relationships (homestead_id,source_record_id,target_record_id,relationship_type,details)
  values (current_setting('regula.relationships_a')::uuid,'b7100000-0000-0000-0000-000000000003','b7100000-0000-0000-0000-000000000001','parent_of','{"parentRole":"sire"}')$$, 'Sire relationship is accepted');
select throws_ok($$insert into public.record_relationships (homestead_id,source_record_id,target_record_id,relationship_type,details)
  values (current_setting('regula.relationships_a')::uuid,'b7100000-0000-0000-0000-000000000003','b7100000-0000-0000-0000-000000000001','parent_of','{"parentRole":"dam"}')$$,
  '23505', null, 'only one active Dam is allowed');
select throws_ok($$insert into public.record_relationships (homestead_id,source_record_id,target_record_id,relationship_type,details)
  values (current_setting('regula.relationships_a')::uuid,'b7100000-0000-0000-0000-000000000002','b7100000-0000-0000-0000-000000000004','parent_of','{"parentRole":"dam"}')$$,
  '23514', 'Parentage requires individual Animals and a Dam or Sire role', 'Group Animals reject parentage');

insert into public.homestead_people (id,homestead_id,person_type,display_name,created_by,updated_by) values
  ('b7300000-0000-0000-0000-000000000001',current_setting('regula.relationships_a')::uuid,'child','Clare','b7000000-0000-0000-0000-000000000001','b7000000-0000-0000-0000-000000000001'),
  ('b7300000-0000-0000-0000-000000000002',current_setting('regula.relationships_b')::uuid,'child','Foreign Child','b7000000-0000-0000-0000-000000000002','b7000000-0000-0000-0000-000000000002');
select lives_ok($$update public.records set stewardship='{"responsiblePersonId":"b7300000-0000-0000-0000-000000000001"}' where id='b7100000-0000-0000-0000-000000000001'$$, 'same-Homestead responsible Person is accepted');
select throws_ok($$update public.records set stewardship='{"responsiblePersonId":"b7300000-0000-0000-0000-000000000002"}' where id='b7100000-0000-0000-0000-000000000001'$$,
  '23514', 'Responsible Person must be active in this Homestead', 'cross-Homestead responsibility is rejected');
select throws_ok($$update public.records set stewardship='{"responsiblePersonId":"legacy-name"}' where id='b7100000-0000-0000-0000-000000000001'$$,
  '23514', 'Responsible Person must use a stable Person identifier', 'free-text canonical responsibility is rejected');

select ok((select relrowsecurity from pg_class where oid='public.record_relationships'::regclass), 'record_relationships remains RLS protected');

select * from finish();
rollback;
