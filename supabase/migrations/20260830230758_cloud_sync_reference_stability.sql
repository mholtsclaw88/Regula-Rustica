-- Restore the current Chore Window foundation and make stale Task references
-- converge instead of permanently blocking a device outbox.

select pg_catalog.set_config('regula.allow_deleted_state', 'true', true);

with ranked as (
  select id, row_number() over (
    partition by homestead_id, system_key
    order by (deleted_at is null) desc, updated_at desc, created_at desc
  ) as position
  from public.chore_windows
  where system_key in ('morning', 'evening')
)
update public.chore_windows as cw
set deleted_at = null,
    deleted_by = null,
    enabled = true,
    name = case cw.system_key when 'morning' then 'Morning' else 'Evening' end,
    display_order = case cw.system_key when 'morning' then 10 else 20 end,
    daypart = cw.system_key,
    start_time = coalesce(cw.start_time, case cw.system_key when 'morning' then time '06:00' else time '17:00' end),
    end_time = coalesce(cw.end_time, case cw.system_key when 'morning' then time '09:00' else time '20:00' end),
    updated_at = now()
from ranked
where ranked.id = cw.id and ranked.position = 1;

insert into public.chore_windows (
  homestead_id, system_key, name, display_order, enabled, daypart,
  start_time, end_time, source
)
select homestead.id, defaults.system_key, defaults.name, defaults.display_order,
       true, defaults.system_key, defaults.start_time, defaults.end_time, 'system'
from public.homesteads as homestead
cross join (values
  ('morning'::text, 'Morning'::text, 10, time '06:00', time '09:00'),
  ('evening'::text, 'Evening'::text, 20, time '17:00', time '20:00')
) as defaults(system_key, name, display_order, start_time, end_time)
where not exists (
  select 1 from public.chore_windows existing
  where existing.homestead_id = homestead.id
    and existing.system_key = defaults.system_key
    and existing.deleted_at is null
);

create or replace function public.complete_recurring_task(task_to_complete uuid, operation_key text, client_device_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_user();
  tenant uuid := public.current_homestead_id();
  current_task public.tasks%rowtype;
  next_id uuid;
  next_window uuid;
  base_date date;
  next_due date;
  every_n integer;
  series_id text;
begin
  if tenant is null or not public.has_capability('complete_tasks') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into current_task from public.tasks
  where id = task_to_complete and homestead_id = tenant and deleted_at is null for update;
  if current_task.id is null then raise exception 'Task not found' using errcode = 'P0002'; end if;
  series_id := current_task.recurrence_rule ->> 'seriesId';
  if current_task.status = 'completed' then
    select id into next_id from public.tasks
    where homestead_id = tenant and deleted_at is null
      and ((series_id is not null and recurrence_rule ->> 'seriesId' = series_id) or parent_task_id = current_task.id)
      and coalesce(due_date, available_from) > coalesce(current_task.due_date, current_task.available_from)
    order by coalesce(due_date, available_from), created_at limit 1;
    return next_id;
  end if;
  if public.current_member_role() = 'hand' and not exists (
    select 1 from public.task_assignments assignment
    join public.homestead_members member on member.id = assignment.member_id
    where assignment.task_id = current_task.id and assignment.removed_at is null
      and member.user_id = actor and member.status = 'active'
  ) then raise exception 'Task is not assigned to this member' using errcode = '42501'; end if;
  select id into next_window from public.chore_windows
  where id = current_task.chore_window_id and homestead_id = tenant and deleted_at is null;
  perform set_config('regula.allow_task_completion', 'true', true);
  update public.tasks set status = 'completed', completed_at = now(), completed_by = actor,
    updated_by = actor, chore_window_id = next_window where id = current_task.id;
  if current_task.recurrence_rule is not null
     and coalesce((current_task.recurrence_rule ->> 'enabled')::boolean, true)
     and coalesce((current_task.recurrence_rule ->> 'seriesDeleted')::boolean, false) = false then
    every_n := greatest(coalesce((current_task.recurrence_rule ->> 'interval')::integer, 1), 1);
    base_date := case when current_task.recurrence_rule ->> 'mode' = 'after_completion'
      then current_date else coalesce(current_task.due_date, current_date) end;
    next_due := case current_task.recurrence_rule ->> 'frequency'
      when 'daily' then base_date + every_n
      when 'weekly' then base_date + (7 * every_n)
      when 'monthly' then (base_date + make_interval(months => every_n))::date end;
    if next_due is null then raise exception 'Unsupported recurrence frequency' using errcode = '22023'; end if;
    if series_id is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(concat_ws(':', tenant, series_id, next_due), 0));
    end if;
    if series_id is null or not exists (
      select 1 from public.tasks where homestead_id = tenant
        and recurrence_rule ->> 'seriesId' = series_id and due_date = next_due
    ) then
      insert into public.tasks (
        homestead_id, record_id, parent_task_id, title, description, status, priority,
        due_date, recurrence_rule, chore_window_id, yield_type, suggestion_key,
        created_by, updated_by, source
      ) values (
        tenant, current_task.record_id, current_task.id, current_task.title,
        current_task.description, 'open', current_task.priority, next_due,
        current_task.recurrence_rule, next_window, current_task.yield_type,
        current_task.suggestion_key, actor, actor, 'system'
      ) on conflict do nothing returning id into next_id;
    else
      select id into next_id from public.tasks where homestead_id = tenant and deleted_at is null
        and recurrence_rule ->> 'seriesId' = series_id and due_date = next_due limit 1;
    end if;
  end if;
  insert into public.sync_operations (
    homestead_id, user_id, device_id, idempotency_key, operation_type, table_name,
    row_id, request_hash, status, processed_at
  ) values (
    tenant, actor, client_device_id, operation_key, 'complete_task', 'tasks', current_task.id,
    encode(extensions.digest(current_task.id::text || ':' || operation_key, 'sha256'), 'hex'), 'processed', now()
  ) on conflict (homestead_id, user_id, idempotency_key) do nothing;
  return next_id;
end;
$$;

create or replace function public.apply_task_sync_operation(
  operation_key text, client_device_id uuid, target_table text, target_id uuid,
  operation_kind text, expected_version integer, client_timestamp timestamptz, operation_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_user();
  tenant uuid := public.current_homestead_id();
  request_digest text;
  prior public.sync_operations%rowtype;
  current_task public.tasks%rowtype;
  current_row jsonb;
  result jsonb;
  series_id text;
  task_due date;
  record_ref uuid;
  parent_ref uuid;
  window_ref uuid;
begin
  if tenant is null or target_table <> 'tasks' or operation_kind not in ('create', 'update', 'soft_delete', 'restore') then
    raise exception 'Unsupported Task sync operation' using errcode = '22023';
  end if;
  operation_payload := coalesce(operation_payload, '{}'::jsonb);
  request_digest := encode(extensions.digest(concat_ws(':', client_device_id, target_table, target_id, operation_kind, coalesce(expected_version::text, ''), coalesce(client_timestamp::text, ''), operation_payload::text), 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(concat_ws(':', tenant, actor, operation_key), 0));
  select * into prior from public.sync_operations
  where homestead_id = tenant and user_id = actor and idempotency_key = operation_key for update;
  if prior.id is not null then
    if prior.request_hash is distinct from request_digest then
      raise exception 'Idempotency key was reused for a different request' using errcode = '22023';
    end if;
    return prior.response;
  end if;
  select id into record_ref from public.records where id = (operation_payload ->> 'record_id')::uuid
    and homestead_id = tenant and deleted_at is null;
  select id into parent_ref from public.tasks where id = (operation_payload ->> 'parent_task_id')::uuid
    and homestead_id = tenant;
  select id into window_ref from public.chore_windows where id = (operation_payload ->> 'chore_window_id')::uuid
    and homestead_id = tenant and deleted_at is null;
  if operation_kind <> 'create' then
    select * into current_task from public.tasks where id = target_id and homestead_id = tenant for update;
  end if;
  if current_task.id is not null and current_task.deleted_at is not null and operation_kind <> 'restore' then
    null; -- Cloud deletion wins over stale edits from a recovered device.
  elsif operation_kind = 'create' then
    if not public.has_capability('create_tasks') then raise exception 'Not authorized' using errcode = '42501'; end if;
    series_id := operation_payload -> 'recurrence_rule' ->> 'seriesId';
    task_due := (operation_payload ->> 'due_date')::date;
    if series_id is not null and task_due is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(concat_ws(':', tenant, series_id, task_due), 0));
      select * into current_task from public.tasks where homestead_id = tenant
        and recurrence_rule ->> 'seriesId' = series_id and due_date = task_due
      order by deleted_at nulls first, created_at limit 1;
    end if;
    if current_task.id is null then
      insert into public.tasks (
        id, homestead_id, record_id, title, description, status, priority, available_from,
        due_date, recurrence_rule, parent_task_id, chore_window_id, yield_type,
        suggestion_key, created_by, updated_by, client_updated_at
      ) values (
        target_id, tenant, record_ref, operation_payload ->> 'title', operation_payload ->> 'description',
        coalesce(operation_payload ->> 'status', 'open'), coalesce(operation_payload ->> 'priority', 'normal'),
        (operation_payload ->> 'available_from')::date, task_due,
        nullif(operation_payload -> 'recurrence_rule', 'null'::jsonb), parent_ref, window_ref,
        operation_payload ->> 'yield_type', operation_payload ->> 'suggestion_key', actor, actor, client_timestamp
      ) on conflict do nothing returning * into current_task;
    end if;
    if current_task.id is null then select * into current_task from public.tasks where id = target_id and homestead_id = tenant; end if;
    if current_task.id is null and parent_ref is not null then
      select * into current_task from public.tasks where homestead_id = tenant and parent_task_id = parent_ref
      order by deleted_at nulls first, created_at limit 1;
    end if;
  elsif operation_kind = 'update' and operation_payload ->> 'status' = 'completed' then
    perform public.complete_recurring_task(target_id, operation_key || ':complete', client_device_id);
    select * into current_task from public.tasks where id = target_id and homestead_id = tenant;
  else
    if expected_version is null or not public.has_capability('create_tasks') then
      raise exception 'Not authorized' using errcode = '42501';
    end if;
    if operation_kind in ('soft_delete', 'restore') then
      perform set_config('regula.allow_deleted_state', 'true', true);
      update public.tasks set
        record_id = case when operation_kind = 'restore' then record_ref else record_id end,
        parent_task_id = case when operation_kind = 'restore' then parent_ref else parent_task_id end,
        chore_window_id = case when operation_kind = 'restore' then window_ref else chore_window_id end,
        deleted_at = case when operation_kind = 'restore' then null else now() end,
        deleted_by = case when operation_kind = 'restore' then null else actor end,
        updated_by = actor, client_updated_at = client_timestamp
      where id = target_id and homestead_id = tenant and version = expected_version returning * into current_task;
    else
      update public.tasks set record_id = record_ref, title = operation_payload ->> 'title',
        description = operation_payload ->> 'description', status = operation_payload ->> 'status',
        priority = operation_payload ->> 'priority', available_from = (operation_payload ->> 'available_from')::date,
        due_date = (operation_payload ->> 'due_date')::date,
        recurrence_rule = nullif(operation_payload -> 'recurrence_rule', 'null'::jsonb),
        parent_task_id = parent_ref, chore_window_id = window_ref,
        yield_type = operation_payload ->> 'yield_type', suggestion_key = operation_payload ->> 'suggestion_key',
        updated_by = actor, client_updated_at = client_timestamp
      where id = target_id and homestead_id = tenant and version = expected_version returning * into current_task;
    end if;
  end if;
  current_row := to_jsonb(current_task);
  result := jsonb_build_object('status', case when current_task.id is null then 'conflict' else 'applied' end, 'row', current_row);
  insert into public.sync_operations (
    homestead_id, user_id, device_id, idempotency_key, operation_type, table_name,
    row_id, request_hash, status, response, processed_at
  ) values (
    tenant, actor, client_device_id, operation_key, operation_kind, 'tasks', target_id,
    request_digest, 'processed', result, now()
  );
  return result;
end;
$$;

revoke execute on function public.complete_recurring_task(uuid, text, uuid) from public, anon;
grant execute on function public.complete_recurring_task(uuid, text, uuid) to authenticated;
revoke execute on function public.apply_task_sync_operation(text, uuid, text, uuid, text, integer, timestamptz, jsonb) from public, anon;
grant execute on function public.apply_task_sync_operation(text, uuid, text, uuid, text, integer, timestamptz, jsonb) to authenticated;
