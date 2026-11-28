\set ON_ERROR_STOP on
-- Run only in a disposable, empty PostgreSQL 17 database. All data is synthetic.
-- Dependency stubs model only columns read by the actual notification functions.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create schema private;
create schema extensions;
create extension pgcrypto with schema extensions;
create table auth.users(id uuid primary key);
create table public.homesteads(id uuid primary key, timezone text, deleted_at timestamptz);
create table public.homestead_members(user_id uuid, homestead_id uuid, status text);
create table public.chore_windows(id uuid primary key, homestead_id uuid, name text,
  enabled boolean, deleted_at timestamptz, end_time time);
create table public.premium_entitlements(homestead_id uuid, revoked_at timestamptz,
  starts_at timestamptz, ends_at timestamptz, feature_keys text[]);
create table public.records(id uuid, homestead_id uuid, deleted_at timestamptz, status text);
create table public.tasks(id uuid, homestead_id uuid, chore_window_id uuid, due_date date,
  available_from date, status text, deleted_at timestamptz, recurrence_rule jsonb,
  record_id uuid, created_at timestamptz, updated_at timestamptz);
create function auth.uid() returns uuid language sql as $$select null::uuid$$;
create function public.current_homestead_id() returns uuid language sql as $$select null::uuid$$;
\ir ../supabase/migrations/20261110022317_chore_window_push_reminders.sql

create function public.check_claim_test(condition boolean, message text) returns void
language plpgsql as $$begin
  if condition is distinct from true then raise exception 'FAIL: %', message; end if;
  raise notice 'PASS: %', message;
end$$;
insert into private.chore_push_sender_auth(token_hash)
values(encode(extensions.digest('synthetic-local-token', 'sha256'), 'hex'));
-- A valid token reaches planning even when there are no subscriptions.
do $$begin
  perform * from public.claim_due_chore_push('synthetic-local-token');
  raise exception 'Original function unexpectedly passed';
exception when ambiguous_column then
  if sqlerrm <> 'column reference "subscription_id" is ambiguous' then raise; end if;
  raise notice 'PASS: original function reproduces SQLSTATE 42702: %', sqlerrm;
end$$;

-- Supabase grants service_role EXECUTE through its default privileges. Model
-- that existing production ACL before replacement, without changing the migration.
grant execute on function public.claim_due_chore_push(text) to service_role;
create temporary table before_security as
select proacl, prosecdef, proconfig from pg_proc
where oid='public.claim_due_chore_push(text)'::regprocedure;
\ir ../supabase/migrations/20261128150117_qualify_chore_push_claim_conflict.sql
select public.check_claim_test((select row(p.proacl,p.prosecdef,p.proconfig) is not distinct from
  row(b.proacl,b.prosecdef,b.proconfig) from pg_proc p cross join before_security b
  where p.oid='public.claim_due_chore_push(text)'::regprocedure), 'function privileges, definer and search path unchanged');
select public.check_claim_test((select count(*)=0 from public.claim_due_chore_push('synthetic-local-token')), 'authorized empty claim succeeds');
select public.check_claim_test(has_function_privilege('anon','public.claim_due_chore_push(text)','execute')
  and has_function_privilege('service_role','public.claim_due_chore_push(text)','execute')
  and not has_function_privilege('authenticated','public.claim_due_chore_push(text)','execute'), 'execute roles remain restricted');
select public.check_claim_test((select bool_and(relrowsecurity) from pg_class
  where oid in ('private.chore_push_sender_auth'::regclass, 'private.chore_push_deliveries'::regclass,
  'public.chore_push_subscriptions'::regclass)), 'all notification tables retain RLS');
select public.check_claim_test(not has_table_privilege('anon','private.chore_push_deliveries','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.chore_push_deliveries','select,insert,update,delete')
  and not has_table_privilege('anon','private.chore_push_sender_auth','select,insert,update,delete'), 'private table grants remain closed');
do $$begin
  perform * from public.claim_due_chore_push('wrong-synthetic-token');
  raise exception 'Wrong token unexpectedly passed';
exception when insufficient_privilege then raise notice 'PASS: wrong token rejected'; end$$;
set role anon;
select public.check_claim_test((select count(*)=0 from public.claim_due_chore_push('synthetic-local-token')), 'anon with valid token can claim');
do $$begin
  perform * from public.claim_due_chore_push(null);
  raise exception 'Null token unexpectedly passed';
exception when insufficient_privilege then raise notice 'PASS: anon null token rejected'; end$$;
reset role;
set role authenticated;
do $$begin
  perform * from public.claim_due_chore_push('synthetic-local-token');
  raise exception 'Authenticated role unexpectedly passed';
exception when insufficient_privilege then raise notice 'PASS: authenticated execution rejected'; end$$;
reset role;

insert into auth.users values('00000000-0000-0000-0000-000000000001');
insert into public.homesteads values('00000000-0000-0000-0000-000000000002','UTC',null);
insert into public.homestead_members values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','active');
-- Avoid midnight edge cases: use the most recent minute as the round's end.
insert into public.chore_windows values('00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000002','Synthetic round',true,null,
  ((now() at time zone 'UTC') - interval '1 minute')::time);
insert into public.premium_entitlements values('00000000-0000-0000-0000-000000000002',null,now()-interval '1 day',null,array['cloud_sync']);
insert into public.chore_push_subscriptions(id,homestead_id,user_id,device_id,endpoint,p256dh,auth_secret)
values('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005',
  'https://fcm.googleapis.com/fcm/send/synthetic-never-sent',repeat('A',87),repeat('B',22));

update public.chore_push_subscriptions set enabled=false;
select public.check_claim_test((select count(*)=0 from public.claim_due_chore_push('synthetic-local-token')), 'disabled subscription excluded');
update public.chore_push_subscriptions set enabled=true;
update public.chore_windows set enabled=false;
select public.check_claim_test((select count(*)=0 from public.claim_due_chore_push('synthetic-local-token')), 'disabled window excluded');
update public.chore_windows set enabled=true;
update public.homestead_members set status='inactive';
select public.check_claim_test((select count(*)=0 from public.claim_due_chore_push('synthetic-local-token')), 'inactive membership excluded');
update public.homestead_members set status='active';
update public.premium_entitlements set ends_at=now()-interval '1 second';
select public.check_claim_test((select count(*)=0 from public.claim_due_chore_push('synthetic-local-token')), 'expired premium excluded');
update public.premium_entitlements set ends_at=null;
update public.premium_entitlements set revoked_at=now();
select public.check_claim_test((select count(*)=0 from public.claim_due_chore_push('synthetic-local-token')), 'revoked premium excluded');
update public.premium_entitlements set revoked_at=null, feature_keys=array['other'];
select public.check_claim_test((select count(*)=0 from public.claim_due_chore_push('synthetic-local-token')), 'missing cloud_sync feature excluded');
update public.premium_entitlements set feature_keys=array['cloud_sync'];

create temporary table first_claim as select * from public.claim_due_chore_push('synthetic-local-token');
select public.check_claim_test((select count(*)=1 and bool_and(task_context='[]'::jsonb) from first_claim), 'one due claim with minimal empty context');
select public.check_claim_test((select count(*)=0 from public.claim_due_chore_push('synthetic-local-token')), 'active lease prevents duplicate claim');
update private.chore_push_deliveries set lease_until=now()-interval '1 second';
create temporary table second_claim as select * from public.claim_due_chore_push('synthetic-local-token');
select public.check_claim_test((select count(*)=1 and bool_and(a.delivery_id=b.delivery_id and a.lease_token<>b.lease_token)
  from first_claim a cross join second_claim b), 'expired lease reclaims same delivery with fresh token');
select public.check_claim_test((select attempts=2 from private.chore_push_deliveries), 'reclaim increments attempts');
select public.check_claim_test((select not public.finish_chore_push('synthetic-local-token',delivery_id,lease_token,'sent') from first_claim), 'stale lease cannot finish');
select public.check_claim_test((select public.finish_chore_push('synthetic-local-token',delivery_id,lease_token,'retry') from second_claim), 'retry releases lease');
create temporary table third_claim as select * from public.claim_due_chore_push('synthetic-local-token');
select public.check_claim_test((select count(*)=1 from third_claim), 'retry can be reclaimed');
select public.check_claim_test((select public.finish_chore_push('synthetic-local-token',delivery_id,lease_token,'sent') from third_claim), 'current lease finishes');
select public.check_claim_test((select not public.finish_chore_push('synthetic-local-token',delivery_id,lease_token,'sent') from third_claim), 'finish is idempotent');
update private.chore_push_deliveries set lease_until=now()-interval '1 second';
select public.check_claim_test((select count(*)=0 from public.claim_due_chore_push('synthetic-local-token')), 'sent delivery never reclaimed');
update private.chore_push_deliveries set sent_at=null, attempts=100;
select public.check_claim_test((select count(*)=0 from public.claim_due_chore_push('synthetic-local-token')), 'attempt cap preserved');
\echo PASS: synthetic notification claim PostgreSQL regression complete
