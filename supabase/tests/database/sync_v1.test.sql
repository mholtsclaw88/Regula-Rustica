begin;

create extension if not exists pgtap with schema extensions;
select plan(21);

select has_function('public', 'apply_sync_operation', array['text','uuid','text','uuid','text','integer','timestamp with time zone','jsonb'], 'sync RPC exists');
select has_column('public', 'sync_operations', 'response', 'idempotent response is retained');
select has_column('public', 'task_assignments', 'updated_at', 'assignments have a pull cursor timestamp');
select has_column('public', 'task_assignments', 'version', 'assignments support optimistic versions');

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
  ('00000000-0000-0000-0000-000000000000','71000000-0000-0000-0000-000000000001','authenticated','authenticated','sync-steward-a@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false),
  ('00000000-0000-0000-0000-000000000000','71000000-0000-0000-0000-000000000002','authenticated','authenticated','sync-guest-a@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false),
  ('00000000-0000-0000-0000-000000000000','72000000-0000-0000-0000-000000000001','authenticated','authenticated','sync-steward-b@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false);

set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
select public.create_homestead('Sync A') as homestead_a \gset
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','72000000-0000-0000-0000-000000000001',true);
select public.create_homestead('Sync B') as homestead_b \gset
reset role;
insert into public.homestead_members (homestead_id,user_id,role,status,joined_at) values
  (:'homestead_a','71000000-0000-0000-0000-000000000002','guest','active',now());

set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
select public.apply_sync_operation(
  'create-record-1','73000000-0000-0000-0000-000000000001','records','74000000-0000-0000-0000-000000000001','create',null,now(),
  jsonb_build_object('id','74000000-0000-0000-0000-000000000001','homestead_id',:'homestead_b','type','animal','name','Local Cow','status','active','identity','{}'::jsonb,'stewardship','{}'::jsonb,'source','manual')
) as created_result \gset
select is((:'created_result'::jsonb ->> 'status'), 'applied', 'authorized create is applied');
select is((select homestead_id from public.records where id = '74000000-0000-0000-0000-000000000001'), :'homestead_a'::uuid, 'server derives Homestead despite spoofed payload');

select public.apply_sync_operation(
  'create-record-1','73000000-0000-0000-0000-000000000001','records','74000000-0000-0000-0000-000000000001','create',null,
  (select client_updated_at from public.records where id='74000000-0000-0000-0000-000000000001'),
  jsonb_build_object('id','74000000-0000-0000-0000-000000000001','homestead_id',:'homestead_b','type','animal','name','Local Cow','status','active','identity','{}'::jsonb,'stewardship','{}'::jsonb,'source','manual')
) as retry_result \gset
select is((select count(*) from public.records where id='74000000-0000-0000-0000-000000000001'), 1::bigint, 'idempotent retry does not duplicate a row');
select is((select count(*) from public.sync_operations where idempotency_key='create-record-1'), 1::bigint, 'idempotent retry records one operation');

select public.apply_sync_operation(
  'update-record-1','73000000-0000-0000-0000-000000000001','records','74000000-0000-0000-0000-000000000001','update',1,now(),
  '{"id":"74000000-0000-0000-0000-000000000001","type":"animal","name":"Updated Cow","status":"active","identity":{},"stewardship":{}}'
) as update_result \gset
select is((:'update_result'::jsonb ->> 'status'), 'applied', 'same-version update succeeds');
select is((select version from public.records where id='74000000-0000-0000-0000-000000000001'), 2, 'accepted update increments server version');

select public.apply_sync_operation(
  'stale-record-1','73000000-0000-0000-0000-000000000001','records','74000000-0000-0000-0000-000000000001','update',1,now(),
  '{"id":"74000000-0000-0000-0000-000000000001","type":"animal","name":"Stale Cow","status":"active","identity":{},"stewardship":{}}'
) as stale_result \gset
select is((:'stale_result'::jsonb ->> 'status'), 'conflict', 'stale version returns an explicit conflict');
select is((select name from public.records where id='74000000-0000-0000-0000-000000000001'), 'Updated Cow', 'stale update preserves cloud row');

select public.apply_sync_operation('delete-record-1','73000000-0000-0000-0000-000000000001','records','74000000-0000-0000-0000-000000000001','soft_delete',2,now(),'{}') as delete_result \gset
select ok((select deleted_at is not null from public.records where id='74000000-0000-0000-0000-000000000001'), 'sync soft delete is explicit');
select public.apply_sync_operation('restore-record-1','73000000-0000-0000-0000-000000000001','records','74000000-0000-0000-0000-000000000001','restore',3,now(),'{}') as restore_result \gset
select ok((select deleted_at is null from public.records where id='74000000-0000-0000-0000-000000000001'), 'sync restore is explicit');

select set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000002',true);
select throws_ok(
  $$select public.apply_sync_operation('guest-create','73000000-0000-0000-0000-000000000002','records','74000000-0000-0000-0000-000000000002','create',null,now(),'{"type":"animal","name":"Denied","status":"active"}')$$,
  '42501','Not authorized','Guest sync write is denied');
select throws_ok(
  $$select public.apply_sync_operation('guest-ledger','73000000-0000-0000-0000-000000000002','ledger_entries','75000000-0000-0000-0000-000000000001','create',null,now(),'{"entry_type":"expense","entry_date":"2026-08-06","description":"Denied","amount":1,"currency_code":"USD"}')$$,
  '42501','Not authorized','Guest cannot sync Ledger data');

select set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
select public.apply_sync_operation('foreign-target','73000000-0000-0000-0000-000000000001','records','76000000-0000-0000-0000-000000000001','update',1,now(),'{"type":"animal","name":"Probe","status":"active"}') as foreign_result \gset
select is((:'foreign_result'::jsonb -> 'row')::text, 'null', 'missing or foreign row is not disclosed by sync conflict');
select is((select count(*) from public.audit_entries where row_id='74000000-0000-0000-0000-000000000001' and action in ('insert','update','soft_delete','restore')), 4::bigint, 'sync changes remain auditable');

insert into public.tasks (id,homestead_id,title,status,priority,due_date,recurrence_rule,created_by,updated_by)
values ('77000000-0000-0000-0000-000000000001',:'homestead_a','Sync recurring','open','normal',current_date,'{"mode":"after_completion","frequency":"weekly","interval":1}','71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001');
select public.apply_sync_operation(
  'complete-sync-recurring','73000000-0000-0000-0000-000000000001','tasks','77000000-0000-0000-0000-000000000001','update',1,now(),
  '{"id":"77000000-0000-0000-0000-000000000001","record_id":null,"title":"Sync recurring","description":null,"status":"completed","priority":"normal","available_from":null,"due_date":"2026-08-06","completed_at":"2026-08-06T12:00:00Z","recurrence_rule":{"mode":"after_completion","frequency":"weekly","interval":1},"parent_task_id":null}'
) as recurring_result \gset
select is((:'recurring_result'::jsonb ->> 'status'),'applied','sync task completion is applied');
select is((select count(*) from public.tasks where parent_task_id='77000000-0000-0000-0000-000000000001'),1::bigint,'sync completion creates one next recurring task');
select public.apply_sync_operation(
  'complete-sync-recurring','73000000-0000-0000-0000-000000000001','tasks','77000000-0000-0000-0000-000000000001','update',1,now(),
  '{"id":"77000000-0000-0000-0000-000000000001","record_id":null,"title":"Sync recurring","description":null,"status":"completed","priority":"normal","available_from":null,"due_date":"2026-08-06","completed_at":"2026-08-06T12:00:00Z","recurrence_rule":{"mode":"after_completion","frequency":"weekly","interval":1},"parent_task_id":null}'
);
select is((select count(*) from public.tasks where parent_task_id='77000000-0000-0000-0000-000000000001'),1::bigint,'idempotent retry does not duplicate recurrence');

select * from finish();
rollback;
