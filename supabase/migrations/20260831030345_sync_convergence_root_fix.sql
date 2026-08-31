-- Make historical Task replay converge instead of repeating completed updates.
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
  task_available date;
  record_ref uuid;
  parent_ref uuid;
  window_ref uuid;
  next_status text;
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

  task_due := nullif(operation_payload ->> 'due_date', '')::date;
  task_available := nullif(operation_payload ->> 'available_from', '')::date;
  if task_due is not null and task_available is not null and task_available > task_due then
    task_available := null;
  end if;
  next_status := coalesce(operation_payload ->> 'status', 'open');

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
    null;
  elsif operation_kind = 'create' then
    if not public.has_capability('create_tasks') then raise exception 'Not authorized' using errcode = '42501'; end if;
    series_id := operation_payload -> 'recurrence_rule' ->> 'seriesId';
    if series_id is not null and task_due is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(concat_ws(':', tenant, series_id, task_due), 0));
      select * into current_task from public.tasks where homestead_id = tenant
        and recurrence_rule ->> 'seriesId' = series_id and due_date = task_due
      order by deleted_at nulls first, created_at limit 1;
    end if;
    if current_task.id is null then
      if next_status = 'completed' then
        perform set_config('regula.allow_task_completion', 'true', true);
      end if;
      insert into public.tasks (
        id, homestead_id, record_id, title, description, status, priority, available_from,
        due_date, completed_at, completed_by, recurrence_rule, parent_task_id,
        chore_window_id, yield_type, suggestion_key, created_by, updated_by, client_updated_at
      ) values (
        target_id, tenant, record_ref, operation_payload ->> 'title', operation_payload ->> 'description',
        next_status, coalesce(operation_payload ->> 'priority', 'normal'), task_available, task_due,
        case when next_status = 'completed' then coalesce(nullif(operation_payload ->> 'completed_at', '')::timestamptz, client_timestamp, now()) end,
        case when next_status = 'completed' then actor end,
        nullif(operation_payload -> 'recurrence_rule', 'null'::jsonb), parent_ref, window_ref,
        operation_payload ->> 'yield_type', operation_payload ->> 'suggestion_key',
        actor, actor, client_timestamp
      ) on conflict do nothing returning * into current_task;
    end if;
    if current_task.id is null then
      select * into current_task from public.tasks where id = target_id and homestead_id = tenant;
    end if;
    if current_task.id is null and parent_ref is not null then
      select * into current_task from public.tasks where homestead_id = tenant and parent_task_id = parent_ref
      order by deleted_at nulls first, created_at limit 1;
    end if;
  elsif operation_kind = 'update' and next_status = 'completed' and current_task.status <> 'completed' then
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
      perform set_config('regula.allow_task_completion', 'true', true);
      update public.tasks set
        record_id = record_ref,
        title = operation_payload ->> 'title',
        description = operation_payload ->> 'description',
        status = next_status,
        priority = coalesce(operation_payload ->> 'priority', 'normal'),
        available_from = task_available,
        due_date = task_due,
        completed_at = case when next_status = 'completed'
          then coalesce(current_task.completed_at, nullif(operation_payload ->> 'completed_at', '')::timestamptz, client_timestamp, now())
          else null end,
        completed_by = case when next_status = 'completed' then coalesce(current_task.completed_by, actor) else null end,
        recurrence_rule = nullif(operation_payload -> 'recurrence_rule', 'null'::jsonb),
        parent_task_id = parent_ref,
        chore_window_id = window_ref,
        yield_type = operation_payload ->> 'yield_type',
        suggestion_key = operation_payload ->> 'suggestion_key',
        updated_by = actor,
        client_updated_at = client_timestamp
      where id = target_id and homestead_id = tenant and version = expected_version
      returning * into current_task;
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

revoke execute on function public.apply_task_sync_operation(text, uuid, text, uuid, text, integer, timestamptz, jsonb) from public, anon;
grant execute on function public.apply_task_sync_operation(text, uuid, text, uuid, text, integer, timestamptz, jsonb) to authenticated;
