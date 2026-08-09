begin;

create extension if not exists pgtap with schema extensions;
select plan(21);

select ok(to_regprocedure('public.create_invitation(text,public.member_role)') is not null, 'create_invitation RPC exists');
select ok(to_regprocedure('public.list_invitations()') is not null, 'list_invitations RPC exists');
select ok(to_regprocedure('public.revoke_invitation(uuid)') is not null, 'revoke_invitation RPC exists');
select ok(has_function_privilege('authenticated', 'public.create_invitation(text,public.member_role)', 'EXECUTE'), 'authenticated users may call create_invitation');
select ok(not has_function_privilege('anon', 'public.create_invitation(text,public.member_role)', 'EXECUTE'), 'anonymous users cannot call create_invitation');
select ok(not has_table_privilege('authenticated', 'public.invitations', 'SELECT'), 'authenticated users cannot read token hashes directly');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('00000000-0000-0000-0000-000000000000','81000000-0000-0000-0000-000000000001','authenticated','authenticated','invite-steward-a@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false),
  ('00000000-0000-0000-0000-000000000000','81000000-0000-0000-0000-000000000002','authenticated','authenticated','invite-keeper-a@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false),
  ('00000000-0000-0000-0000-000000000000','82000000-0000-0000-0000-000000000001','authenticated','authenticated','invite-steward-b@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false),
  ('00000000-0000-0000-0000-000000000000','83000000-0000-0000-0000-000000000001','authenticated','authenticated','new-steward@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false),
  ('00000000-0000-0000-0000-000000000000','83000000-0000-0000-0000-000000000002','authenticated','authenticated','revoked@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false);

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000001', true);
select public.create_homestead('Invitation Homestead A') as homestead_a \gset
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000001', true);
select public.create_homestead('Invitation Homestead B') as homestead_b \gset
reset role;

insert into public.homestead_members (homestead_id, user_id, role, status, joined_at)
values (:'homestead_a', '81000000-0000-0000-0000-000000000002', 'keeper', 'active', now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000001', true);
select * from public.create_invitation(' New-Steward@Example.Test ', 'steward') \gset first_
reset role;
select is(length(:'first_raw_token'), 64, 'a 256-bit token is returned once as hex');
select is(
  (select token_hash from public.invitations where id = :'first_invitation_id'),
  encode(extensions.digest(:'first_raw_token', 'sha256'), 'hex'),
  'only the token hash is stored');
select is((select role::text from public.invitations where id = :'first_invitation_id'), 'steward', 'Steward is a valid invited role');
select ok(
  :'first_expires_at'::timestamptz between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour',
  'invitations expire after seven days by default');
set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000001', true);
select ok(
  (select not (to_jsonb(invitation) ? 'token_hash') from public.list_invitations() invitation limit 1),
  'invitation listings never expose token hashes');
select throws_ok(
  $$select public.create_invitation('new-steward@example.test', 'guest')$$,
  '23505', 'A pending invitation already exists for that email address',
  'duplicate pending invitations are rejected');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000001', true);
select * from public.create_invitation('other-homestead@example.test', 'guest') \gset other_
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000001', true);
select is((select count(*) from public.list_invitations()), 1::bigint, 'Stewards list invitations only for their Homestead');
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.create_invitation('blocked@example.test', 'hand')$$,
  '42501', 'Not authorized', 'Keepers cannot create invitations');
select throws_ok(
  $$select * from public.list_invitations()$$,
  '42501', 'Not authorized', 'Keepers cannot list invitations');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-000000000001', true);
select is(public.accept_invitation(:'first_raw_token'), :'homestead_a'::uuid, 'the invited person can accept the private token');
select is(public.current_member_role()::text, 'steward', 'an invited Steward receives the assigned role');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000001', true);
select * from public.create_invitation('revoked@example.test', 'hand') \gset revoked_
select is(public.revoke_invitation(:'revoked_invitation_id'), :'revoked_invitation_id'::uuid, 'a Steward can revoke a pending invitation');
select is((select status from public.list_invitations() where invitation_id = :'revoked_invitation_id'), 'revoked', 'revoked status is visible to the Steward');
select ok(exists(
  select 1 from public.audit_entries
  where table_name = 'invitations' and row_id = :'revoked_invitation_id' and action = 'update'
), 'invitation revocation is audited');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-000000000002', true);
select throws_ok(
  format('select public.accept_invitation(%L)', :'revoked_raw_token'),
  '22023', 'Invitation is invalid or expired', 'a revoked invitation cannot be accepted');
reset role;

select * from finish();
rollback;
