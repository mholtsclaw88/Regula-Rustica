begin;

create extension if not exists pgtap with schema extensions;
select plan(37);

select has_table('public', 'homestead_people', 'Homestead people table exists');
select has_column('public', 'task_assignments', 'person_id', 'task assignments reference an assignable person');
select col_is_null('public', 'task_assignments', 'member_id', 'member ID is optional for child assignments');
select col_not_null('public', 'task_assignments', 'person_id', 'every assignment has a person');
select has_function('public', 'apply_people_sync_operation', array['text','uuid','text','uuid','text','integer','timestamp with time zone','jsonb'], 'people sync RPC exists');
select ok((select relrowsecurity from pg_class where oid = 'public.homestead_people'::regclass), 'Homestead people have RLS enabled');

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
  ('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000001','authenticated','authenticated','people-steward-a@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{"display_name":"People Steward A"}',false),
  ('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000002','authenticated','authenticated','people-keeper-a@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{"display_name":"People Keeper A"}',false),
  ('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000003','authenticated','authenticated','people-hand-a@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{"display_name":"People Hand A"}',false),
  ('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000004','authenticated','authenticated','people-guest-a@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{"display_name":"People Guest A"}',false),
  ('00000000-0000-0000-0000-000000000000','92000000-0000-0000-0000-000000000001','authenticated','authenticated','people-steward-b@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{"display_name":"People Steward B"}',false);

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
select public.create_homestead('People A') as homestead_a \gset
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','92000000-0000-0000-0000-000000000001',true);
select public.create_homestead('People B') as homestead_b \gset
reset role;

insert into public.homestead_members (homestead_id,user_id,role,status,joined_at) values
  (:'homestead_a','91000000-0000-0000-0000-000000000002','keeper','active',now()),
  (:'homestead_a','91000000-0000-0000-0000-000000000003','hand','active',now()),
  (:'homestead_a','91000000-0000-0000-0000-000000000004','guest','active',now());

select is((select count(*) from public.homestead_people where homestead_id=:'homestead_a' and person_type='member' and deleted_at is null), 4::bigint, 'active members automatically receive directory entries');
select ok((select bool_and(member_id is not null) from public.homestead_people where homestead_id=:'homestead_a' and person_type='member'), 'account-backed people retain membership links');

insert into public.tasks (id,homestead_id,title,created_by,updated_by) values
  ('93000000-0000-0000-0000-000000000001',:'homestead_a','Feed rabbits','91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001'),
  ('93000000-0000-0000-0000-000000000002',:'homestead_a','Collect kindling','91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
select public.apply_people_sync_operation(
  'child-create-1','94000000-0000-0000-0000-000000000001','homestead_people','95000000-0000-0000-0000-000000000001','create',null,'2026-08-10T12:00:00Z',
  jsonb_build_object('id','95000000-0000-0000-0000-000000000001','homestead_id',:'homestead_b','person_type','child','display_name','Clare')
) as child_created \gset
select is((:'child_created'::jsonb ->> 'status'), 'applied', 'Steward can create a child profile');
select ok((select member_id is null from public.homestead_people where id='95000000-0000-0000-0000-000000000001'), 'child profile has no membership or account link');
select is((select homestead_id from public.homestead_people where id='95000000-0000-0000-0000-000000000001'), :'homestead_a'::uuid, 'child Homestead is derived from the authenticated user');
select public.apply_people_sync_operation(
  'child-create-1','94000000-0000-0000-0000-000000000001','homestead_people','95000000-0000-0000-0000-000000000001','create',null,'2026-08-10T12:00:00Z',
  jsonb_build_object('id','95000000-0000-0000-0000-000000000001','homestead_id',:'homestead_b','person_type','child','display_name','Clare')
);
select is((select count(*) from public.homestead_people where id='95000000-0000-0000-0000-000000000001'), 1::bigint, 'child creation retry is idempotent');
select is((select count(*) from public.sync_operations where idempotency_key='child-create-1'), 1::bigint, 'child retry records one operation');
select throws_ok(
  $$select public.apply_people_sync_operation('child-create-1','94000000-0000-0000-0000-000000000001','homestead_people','95000000-0000-0000-0000-000000000001','create',null,'2026-08-10T12:00:01Z','{"person_type":"child","display_name":"Different"}')$$,
  '22023','Idempotency key was reused for a different request','idempotency keys cannot be reused for different child data');

select public.apply_people_sync_operation(
  'child-assignment-1','94000000-0000-0000-0000-000000000001','task_assignments','96000000-0000-0000-0000-000000000001','create',null,now(),
  '{"task_id":"93000000-0000-0000-0000-000000000001","person_id":"95000000-0000-0000-0000-000000000001","assignment_type":"assignee"}'
) as child_assignment \gset
select is((:'child_assignment'::jsonb ->> 'status'), 'applied', 'a child can be assigned a task');
select ok((select member_id is null from public.task_assignments where id='96000000-0000-0000-0000-000000000001'), 'child assignment carries no membership permission');

select (select id from public.homestead_people where member_id=(select id from public.homestead_members where user_id='91000000-0000-0000-0000-000000000003')) as hand_person \gset
select public.apply_people_sync_operation(
  'hand-assignment-1','94000000-0000-0000-0000-000000000001','task_assignments','96000000-0000-0000-0000-000000000002','create',null,now(),
  jsonb_build_object('task_id','93000000-0000-0000-0000-000000000002','person_id',:'hand_person','assignment_type','assignee')
) as hand_assignment \gset
select is((:'hand_assignment'::jsonb ->> 'status'), 'applied', 'an account user can be assigned through the same directory');
select ok((select member_id is not null from public.task_assignments where id='96000000-0000-0000-0000-000000000002'), 'member assignment retains its authorization link');

select is((select count(*) from public.homestead_people), 5::bigint, 'Steward sees only people in its Homestead');
select throws_ok(
  format($sql$select public.apply_people_sync_operation('foreign-person','94000000-0000-0000-0000-000000000001','task_assignments','96000000-0000-0000-0000-000000000003','create',null,now(),jsonb_build_object('task_id','93000000-0000-0000-0000-000000000001','person_id',(select id from public.homestead_people where homestead_id=%L limit 1)))$sql$, :'homestead_b'),
  '23503','Assignee not found','an assignment cannot target another Homestead person');

select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000003',true);
select is((select count(*) from public.tasks), 1::bigint, 'Hand sees only the task assigned to its account-backed person');
select is((select count(*) from public.task_assignments), 1::bigint, 'Hand cannot read a child assignment');
select is((select count(*) from public.homestead_people), 5::bigint, 'Hand may read the Homestead assignee directory');
select throws_ok(
  $$select public.apply_people_sync_operation('hand-child','94000000-0000-0000-0000-000000000003','homestead_people','95000000-0000-0000-0000-000000000003','create',null,now(),'{"person_type":"child","display_name":"Denied"}')$$,
  '42501','Not authorized','Hand cannot manage child profiles');

select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000004',true);
select throws_ok(
  $$select public.apply_people_sync_operation('guest-child','94000000-0000-0000-0000-000000000004','homestead_people','95000000-0000-0000-0000-000000000004','create',null,now(),'{"person_type":"child","display_name":"Denied"}')$$,
  '42501','Not authorized','Guest cannot manage child profiles');

select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000002',true);
select is((public.apply_people_sync_operation('keeper-child','94000000-0000-0000-0000-000000000002','homestead_people','95000000-0000-0000-0000-000000000002','create',null,now(),'{"person_type":"child","display_name":"Thomas"}') ->> 'status'), 'applied', 'Keeper may manage assignable child profiles');

select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.soft_delete_row('homestead_people','95000000-0000-0000-0000-000000000001')$$, 'child profile soft deletion succeeds');
select ok((select deleted_at is not null from public.homestead_people where id='95000000-0000-0000-0000-000000000001'), 'child profile receives a deletion timestamp');
select ok(exists(select 1 from public.audit_entries where row_id='95000000-0000-0000-0000-000000000001' and action='soft_delete'), 'child soft deletion is audited');
select lives_ok($$select public.restore_row('homestead_people','95000000-0000-0000-0000-000000000001')$$, 'child profile restoration succeeds');
select ok((select deleted_at is null from public.homestead_people where id='95000000-0000-0000-0000-000000000001'), 'child profile is restored');
select ok(exists(select 1 from public.audit_entries where row_id='95000000-0000-0000-0000-000000000001' and action='restore'), 'child restoration is audited');
select throws_ok(
  format($sql$select public.soft_delete_row('homestead_people',%L)$sql$, (select id from public.homestead_people where member_id is not null and homestead_id=:'homestead_a' limit 1)),
  'P0002','Child profile not found','account-backed people cannot be removed through child management');
select throws_ok(
  $$select public.apply_people_sync_operation('member-spoof','94000000-0000-0000-0000-000000000001','homestead_people','95000000-0000-0000-0000-000000000005','create',null,now(),'{"person_type":"member","display_name":"Spoofed"}')$$,
  '42501','Only child profiles may be created by the client','clients cannot create account-backed directory entries');
reset role;

select throws_like(
  format($sql$insert into public.task_assignments (homestead_id,task_id,person_id,assigned_by) values (%L,'93000000-0000-0000-0000-000000000001',(select id from public.homestead_people where homestead_id=%L limit 1),'91000000-0000-0000-0000-000000000001')$sql$, :'homestead_a', :'homestead_b'),
  '%Assignee does not belong to this Homestead%','assignment trigger rejects a foreign Homestead person');
select is((select count(*) from information_schema.role_table_grants where grantee='anon' and table_schema='public' and table_name='homestead_people'), 0::bigint, 'anonymous receives no Homestead people grants');
select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname in ('homesteads','profiles','homestead_members','invitations','records','record_relationships','tasks','task_assignments','chronicle_entries','notes','ledger_entries','audit_entries','sync_operations','calendar_events','yield_entries','homestead_people') and not c.relrowsecurity), 0::bigint, 'RLS remains enabled on every exposed application table');

select * from finish();
rollback;
