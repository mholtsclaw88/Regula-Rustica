begin;

create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '00000000-0000-0000-0000-000000000000',
  'b1000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'sync-stability@example.test',
  crypt('password', gen_salt('bf')), now(), now(), now(), '{}', '{}', false
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', true);
select public.create_homestead('Cloud Sync Stability Test') as homestead_id \gset
reset role;

select is(
  (select count(*) from public.chore_windows
   where homestead_id = :'homestead_id' and system_key in ('morning', 'evening') and deleted_at is null),
  2::bigint,
  'each Homestead has active Morning and Evening Chore Windows'
);

select id as stale_window_id from public.chore_windows
where homestead_id = :'homestead_id' and system_key = 'morning' and deleted_at is null \gset

insert into public.tasks (
  id, homestead_id, title, status, priority, due_date, recurrence_rule,
  chore_window_id, created_by, updated_by
) values (
  'b2000000-0000-0000-0000-000000000001', :'homestead_id', 'Deleted cloud Task',
  'open', 'normal', current_date, null, :'stale_window_id',
  'b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001'
), (
  'b2000000-0000-0000-0000-000000000002', :'homestead_id', 'Recurring Task',
  'open', 'normal', current_date,
  jsonb_build_object(
    'mode', 'fixed_schedule', 'frequency', 'daily', 'interval', 1, 'enabled', true,
    'seriesId', 'b3000000-0000-0000-0000-000000000001'
  ), :'stale_window_id',
  'b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001'
), (
  'b2000000-0000-0000-0000-000000000003', :'homestead_id', 'Active Task',
  'open', 'normal', current_date, null, null,
  'b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001'
);

select set_config('regula.allow_deleted_state', 'true', true);
update public.tasks
set deleted_at = now(), deleted_by = 'b1000000-0000-0000-0000-000000000001'
where id = 'b2000000-0000-0000-0000-000000000001';
update public.chore_windows
set deleted_at = now(), deleted_by = 'b1000000-0000-0000-0000-000000000001'
where id = :'stale_window_id';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', true);
select now() as stale_update_time \gset

select public.apply_task_sync_operation(
  'stale-deleted-update', 'b4000000-0000-0000-0000-000000000001', 'tasks',
  'b2000000-0000-0000-0000-000000000001', 'update', 1, :'stale_update_time'::timestamptz,
  jsonb_build_object(
    'title', 'Old device edit', 'status', 'open', 'priority', 'normal',
    'due_date', current_date::text, 'chore_window_id', :'stale_window_id'
  )
) as deleted_update_result \gset

select is((:'deleted_update_result'::jsonb ->> 'status'), 'applied',
  'a stale update to a cloud-deleted Task converges without blocking');
select ok((:'deleted_update_result'::jsonb -> 'row' ->> 'deleted_at') is not null,
  'cloud deletion wins over the stale Task update');
select is((select title from public.tasks where id = 'b2000000-0000-0000-0000-000000000001'),
  'Deleted cloud Task', 'stale update does not mutate the deleted cloud Task');

select public.apply_task_sync_operation(
  'stale-deleted-update', 'b4000000-0000-0000-0000-000000000001', 'tasks',
  'b2000000-0000-0000-0000-000000000001', 'update', 1, :'stale_update_time'::timestamptz,
  jsonb_build_object(
    'title', 'Old device edit', 'status', 'open', 'priority', 'normal',
    'due_date', current_date::text, 'chore_window_id', :'stale_window_id'
  )
) as repeated_result \gset
select is((:'repeated_result'::jsonb -> 'row' ->> 'id'),
  'b2000000-0000-0000-0000-000000000001', 'stale-delete convergence is idempotent');
select is((select count(*) from public.sync_operations where idempotency_key = 'stale-deleted-update'),
  1::bigint, 'idempotent replay records only one operation');

select public.apply_task_sync_operation(
  'stale-window-create', 'b4000000-0000-0000-0000-000000000001', 'tasks',
  'b2000000-0000-0000-0000-000000000004', 'create', null, now(),
  jsonb_build_object(
    'title', 'Recovered mobile Task', 'status', 'open', 'priority', 'normal',
    'due_date', current_date::text, 'chore_window_id', :'stale_window_id'
  )
) as stale_create_result \gset
select is((:'stale_create_result'::jsonb ->> 'status'), 'applied',
  'Task create ignores a stale deleted Chore Window reference');
select is((select chore_window_id from public.tasks where id = 'b2000000-0000-0000-0000-000000000004'),
  null::uuid, 'created Task stores no invalid Chore Window reference');

select version as active_task_version from public.tasks
where id = 'b2000000-0000-0000-0000-000000000003' \gset
select public.apply_task_sync_operation(
  'stale-window-update', 'b4000000-0000-0000-0000-000000000001', 'tasks',
  'b2000000-0000-0000-0000-000000000003', 'update', :active_task_version, now(),
  jsonb_build_object(
    'title', 'Updated active Task', 'status', 'open', 'priority', 'normal',
    'due_date', current_date::text, 'chore_window_id', :'stale_window_id'
  )
) as stale_update_result \gset
select is((:'stale_update_result'::jsonb ->> 'status'), 'applied',
  'Task update ignores a stale deleted Chore Window reference');
select is((select chore_window_id from public.tasks where id = 'b2000000-0000-0000-0000-000000000003'),
  null::uuid, 'updated Task stores no invalid Chore Window reference');

select public.complete_recurring_task(
  'b2000000-0000-0000-0000-000000000002',
  'complete-with-stale-window',
  'b4000000-0000-0000-0000-000000000001'
) as next_task_id \gset
select is((select status from public.tasks where id = 'b2000000-0000-0000-0000-000000000002'),
  'completed', 'recurring Task with a stale Chore Window still completes');
select is((select chore_window_id from public.tasks where id = :'next_task_id'),
  null::uuid, 'next recurrence does not inherit a deleted Chore Window');
select is((select count(*) from public.tasks where parent_task_id = 'b2000000-0000-0000-0000-000000000002'),
  1::bigint, 'recurring completion creates exactly one next Task');

reset role;
select * from finish();
rollback;
