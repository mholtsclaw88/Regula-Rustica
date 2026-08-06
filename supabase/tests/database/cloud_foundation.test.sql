begin;

create extension if not exists pgtap with schema extensions;
select plan(48);

select has_table('public', 'homesteads', 'homesteads exists');
select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'homestead_members', 'homestead_members exists');
select has_table('public', 'invitations', 'invitations exists');
select has_table('public', 'records', 'records exists');
select has_table('public', 'record_relationships', 'record_relationships exists');
select has_table('public', 'tasks', 'tasks exists');
select has_table('public', 'task_assignments', 'task_assignments exists');
select has_table('public', 'chronicle_entries', 'chronicle_entries exists');
select has_table('public', 'notes', 'notes exists');
select has_table('public', 'ledger_entries', 'ledger_entries exists');
select has_table('public', 'audit_entries', 'audit_entries exists');
select has_table('public', 'sync_operations', 'sync_operations exists');
select hasnt_table('public', 'photos', 'photos remain deferred');

-- Fixed IDs make failures readable and keep the two-Homestead fixture explicit.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000001','authenticated','authenticated','steward-a@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{"display_name":"Steward A"}',false),
  ('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000002','authenticated','authenticated','keeper-a@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{"display_name":"Keeper A"}',false),
  ('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000003','authenticated','authenticated','hand-a@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{"display_name":"Hand A"}',false),
  ('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000004','authenticated','authenticated','guest-a@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{"display_name":"Guest A"}',false),
  ('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000001','authenticated','authenticated','steward-b@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{"display_name":"Steward B"}',false),
  ('00000000-0000-0000-0000-000000000000','30000000-0000-0000-0000-000000000001','authenticated','authenticated','invitee@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{"display_name":"Invitee"}',false),
  ('00000000-0000-0000-0000-000000000000','30000000-0000-0000-0000-000000000002','authenticated','authenticated','expired@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{"display_name":"Expired Invitee"}',false);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select public.create_homestead('First Homestead') as homestead_a \gset
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select public.create_homestead('Second Homestead') as homestead_b \gset
reset role;

insert into public.homestead_members (homestead_id, user_id, role, status, joined_at) values
  (:'homestead_a','10000000-0000-0000-0000-000000000002','keeper','active',now()),
  (:'homestead_a','10000000-0000-0000-0000-000000000003','hand','active',now()),
  (:'homestead_a','10000000-0000-0000-0000-000000000004','guest','active',now());

select throws_ok(
  format($sql$insert into public.homestead_members (homestead_id,user_id,role,status,joined_at) values (%L,'10000000-0000-0000-0000-000000000002','guest','active',now())$sql$, :'homestead_b'),
  '23505', 'one active Homestead per user is enforced');
select is((select count(*) from public.homestead_members where homestead_id = :'homestead_a' and status = 'active'), 4::bigint, 'one Homestead supports many users');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select is(public.current_member_role()::text, 'steward', 'Steward role resolves');
select ok(public.has_capability('manage_members'), 'Steward can manage members');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select is(public.current_member_role()::text, 'keeper', 'Keeper role resolves');
select ok(not public.has_capability('manage_members'), 'Keeper cannot manage members');
select ok(public.has_capability('manage_ledger'), 'Keeper can manage the Ledger');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select is(public.current_member_role()::text, 'hand', 'Hand role resolves');
select ok(public.has_capability('complete_tasks'), 'Hand can complete assigned tasks');
select ok(not public.has_capability('manage_ledger'), 'Hand cannot manage the Ledger');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select is(public.current_member_role()::text, 'guest', 'Guest role resolves');
select ok(public.has_capability('view_records'), 'Guest can view records');
select ok(not public.has_capability('create_records'), 'Guest cannot create records');
reset role;

insert into public.records (id, homestead_id, type, name, status, created_by, updated_by) values
  ('40000000-0000-0000-0000-000000000001', :'homestead_a', 'animal', 'A Cow', 'active', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000002', :'homestead_b', 'land', 'B Field', 'active', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
insert into public.ledger_entries (homestead_id, entry_type, description, amount, created_by, updated_by)
  values (:'homestead_a', 'expense', 'Feed', 25.00, '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select is((select count(*) from public.homesteads), 1::bigint, 'RLS hides the other Homestead');
select is((select count(*) from public.records), 1::bigint, 'RLS isolates records between Homesteads');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select is((select count(*) from public.ledger_entries), 0::bigint, 'Guest cannot view Ledger entries');
reset role;

insert into public.tasks (id, homestead_id, title, due_date, recurrence_rule, created_by, updated_by) values
  ('50000000-0000-0000-0000-000000000001', :'homestead_a', 'Assigned weekly task', current_date, '{"mode":"after_completion","frequency":"weekly","interval":1}', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', :'homestead_a', 'Unassigned task', current_date, null, '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
insert into public.task_assignments (homestead_id, task_id, member_id, assigned_by)
  select :'homestead_a', '50000000-0000-0000-0000-000000000001', id, '10000000-0000-0000-0000-000000000001'
  from public.homestead_members where user_id = '10000000-0000-0000-0000-000000000003';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select is((select count(*) from public.tasks), 1::bigint, 'Hand sees only assigned tasks');
reset role;

insert into public.invitations (homestead_id, email_normalized, role, token_hash, created_at, expires_at, invited_by) values
  (:'homestead_a', 'invitee@example.test', 'hand', encode(extensions.digest('valid-token','sha256'),'hex'), now(), now() + interval '7 days', '10000000-0000-0000-0000-000000000001'),
  (:'homestead_a', 'expired@example.test', 'guest', encode(extensions.digest('expired-token','sha256'),'hex'), now() - interval '8 days', now() - interval '1 day', '10000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true);
select throws_ok($$select public.accept_invitation('expired-token')$$, '22023', 'expired invitation is rejected');
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select is(public.accept_invitation('valid-token'), :'homestead_a'::uuid, 'valid invitation joins its Homestead');
select throws_ok($$select public.accept_invitation('valid-token')$$, '23505', 'accepted invitation cannot be reused');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select public.complete_recurring_task('50000000-0000-0000-0000-000000000001','complete-weekly-1','60000000-0000-0000-0000-000000000001') as next_task \gset
select isnt(:'next_task'::uuid, null::uuid, 'recurring completion creates the next task');
select is(public.complete_recurring_task('50000000-0000-0000-0000-000000000001','complete-weekly-1','60000000-0000-0000-0000-000000000001'), :'next_task'::uuid, 'retry returns the same next occurrence');
select is((select count(*) from public.tasks where parent_task_id = '50000000-0000-0000-0000-000000000001'), 1::bigint, 'only one next occurrence exists');
select is((select status from public.tasks where id = '50000000-0000-0000-0000-000000000001'), 'completed', 'source task is completed');
select is((select count(*) from public.sync_operations where idempotency_key = 'complete-weekly-1'), 1::bigint, 'idempotency operation is recorded once');

select lives_ok($$select public.soft_delete_row('records','40000000-0000-0000-0000-000000000001')$$, 'record soft deletion succeeds');
select ok((select deleted_at is not null from public.records where id = '40000000-0000-0000-0000-000000000001'), 'record has a deletion timestamp');
select ok(exists(select 1 from public.audit_entries where row_id = '40000000-0000-0000-0000-000000000001' and action = 'soft_delete'), 'soft deletion is audited');
select lives_ok($$select public.restore_row('records','40000000-0000-0000-0000-000000000001')$$, 'record restore succeeds');
select ok((select deleted_at is null from public.records where id = '40000000-0000-0000-0000-000000000001'), 'record is restored');
select ok(exists(select 1 from public.audit_entries where row_id = '40000000-0000-0000-0000-000000000001' and action = 'restore'), 'restore is audited');

select throws_ok(
  $$update public.homestead_members set role = 'keeper' where user_id = '10000000-0000-0000-0000-000000000001'$$,
  '23514', 'the final Steward cannot be demoted');
reset role;
update public.homestead_members set role = 'steward'
  where homestead_id = :'homestead_a' and user_id = '10000000-0000-0000-0000-000000000002';
select lives_ok(
  $$update public.homestead_members set role = 'keeper' where user_id = '10000000-0000-0000-0000-000000000001'$$,
  'a Steward may be demoted when another active Steward remains');
select throws_ok(
  $$update public.audit_entries set changed_fields = '[]' where id = (select id from public.audit_entries limit 1)$$,
  'Audit entries are append-only', 'audit entries cannot be changed');

select * from finish();
rollback;
