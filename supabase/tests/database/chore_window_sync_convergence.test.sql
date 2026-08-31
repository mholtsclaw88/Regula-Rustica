begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','b1000000-0000-0000-0000-000000000001','authenticated','authenticated','window-sync-steward@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false);

set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
select public.create_homestead('Window Sync') as homestead_id \gset

select is((select count(*) from public.chore_windows where homestead_id=:'homestead_id' and deleted_at is null),2::bigint,'Homestead begins with two canonical system Chore Windows');
select id as morning_id from public.chore_windows where homestead_id=:'homestead_id' and system_key='morning' and deleted_at is null \gset
select id as evening_id from public.chore_windows where homestead_id=:'homestead_id' and system_key='evening' and deleted_at is null \gset

select public.apply_routine_sync_operation(
  'recovered-morning-create','b2000000-0000-0000-0000-000000000001','chore_windows',
  'b3000000-0000-0000-0000-000000000001','create',null,'2026-08-31T12:32:00Z',
  '{"system_key":"morning","name":"Morning","display_order":10,"enabled":true,"daypart":"morning","start_time":"06:00","end_time":"10:00"}'
) as morning_result \gset
select is((:'morning_result'::jsonb->>'status'),'applied','Recovered Morning create converges without a uniqueness failure');
select is((:'morning_result'::jsonb->'row'->>'id')::uuid,:'morning_id'::uuid,'Recovered Morning create returns the canonical cloud row');
select is((select count(*) from public.chore_windows where homestead_id=:'homestead_id' and system_key='morning' and deleted_at is null),1::bigint,'Recovered Morning create does not duplicate the system window');

select public.apply_routine_sync_operation(
  'recovered-evening-create','b2000000-0000-0000-0000-000000000001','chore_windows',
  'b3000000-0000-0000-0000-000000000002','create',null,'2026-08-31T12:32:01Z',
  '{"system_key":"evening","name":"Evening","display_order":20,"enabled":true,"daypart":"evening","start_time":"18:00","end_time":"22:00"}'
) as evening_result \gset
select is((:'evening_result'::jsonb->>'status'),'applied','Recovered Evening create converges without a uniqueness failure');
select is((:'evening_result'::jsonb->'row'->>'id')::uuid,:'evening_id'::uuid,'Recovered Evening create returns the canonical cloud row');
select is((select count(*) from public.chore_windows where homestead_id=:'homestead_id' and system_key='evening' and deleted_at is null),1::bigint,'Recovered Evening create does not duplicate the system window');

select public.apply_routine_sync_operation(
  'recovered-morning-create','b2000000-0000-0000-0000-000000000001','chore_windows',
  'b3000000-0000-0000-0000-000000000001','create',null,'2026-08-31T12:32:00Z',
  '{"system_key":"morning","name":"Morning","display_order":10,"enabled":true,"daypart":"morning","start_time":"06:00","end_time":"10:00"}'
);
select is((select count(*) from public.sync_operations where idempotency_key in ('recovered-morning-create','recovered-evening-create')),2::bigint,'Semantic convergence remains operation-idempotent');

reset role;
select * from finish();
rollback;
