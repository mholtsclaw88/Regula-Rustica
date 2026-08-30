-- Make current recurring Task creates converge after a resync, then retire the
-- superseded Routine-era rows. All cleanup remains recoverable soft deletion.

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
begin
  if tenant is null or target_table <> 'tasks' or operation_kind not in ('create', 'update', 'soft_delete', 'restore') then
    raise exception 'Unsupported Task sync operation' using errcode = '22023';
  end if;
  operation_payload := coalesce(operation_payload, '{}'::jsonb);
  request_digest := encode(extensions.digest(concat_ws(':', client_device_id, target_table, target_id, operation_kind, coalesce(expected_version::text, ''), coalesce(client_timestamp::text, ''), operation_payload::text), 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(concat_ws(':', tenant, actor, operation_key), 0));
  select * into prior from public.sync_operations
  where homestead_id = tenant and user_id = actor and idempotency_key = operation_key
  for update;
  if prior.id is not null then
    if prior.request_hash is distinct from request_digest then
      raise exception 'Idempotency key was reused for a different request' using errcode = '22023';
    end if;
    return prior.response;
  end if;

  if operation_kind = 'create' then
    if not public.has_capability('create_tasks') then raise exception 'Not authorized' using errcode = '42501'; end if;
    series_id := operation_payload -> 'recurrence_rule' ->> 'seriesId';
    task_due := (operation_payload ->> 'due_date')::date;
    if series_id is not null and task_due is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(concat_ws(':', tenant, series_id, task_due), 0));
      select * into current_task
      from public.tasks
      where homestead_id = tenant and recurrence_rule ->> 'seriesId' = series_id and due_date = task_due
      order by deleted_at nulls first, created_at
      limit 1;
    end if;
    if current_task.id is null then
      insert into public.tasks (
        id, homestead_id, record_id, title, description, status, priority, available_from, due_date,
        recurrence_rule, parent_task_id, chore_window_id, yield_type, suggestion_key,
        created_by, updated_by, client_updated_at
      ) values (
        target_id, tenant, (operation_payload ->> 'record_id')::uuid, operation_payload ->> 'title',
        operation_payload ->> 'description', coalesce(operation_payload ->> 'status', 'open'),
        coalesce(operation_payload ->> 'priority', 'normal'), (operation_payload ->> 'available_from')::date,
        task_due, nullif(operation_payload -> 'recurrence_rule', 'null'::jsonb),
        (operation_payload ->> 'parent_task_id')::uuid, (operation_payload ->> 'chore_window_id')::uuid,
        operation_payload ->> 'yield_type', operation_payload ->> 'suggestion_key', actor, actor, client_timestamp
      ) on conflict do nothing returning * into current_task;
    end if;
    -- A recovered device may submit an occurrence that the cloud already knows
    -- by UUID or by its one-child recurrence link. Rebind to that row instead of
    -- returning an empty conflict that cannot be meaningfully reviewed.
    if current_task.id is null then
      select * into current_task from public.tasks
      where id = target_id and homestead_id = tenant;
    end if;
    if current_task.id is null and nullif(operation_payload ->> 'parent_task_id', '') is not null then
      select * into current_task from public.tasks
      where homestead_id = tenant and parent_task_id = (operation_payload ->> 'parent_task_id')::uuid
      order by deleted_at nulls first, created_at
      limit 1;
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
      update public.tasks
      set deleted_at = case when operation_kind = 'restore' then null else now() end,
          deleted_by = case when operation_kind = 'restore' then null else actor end,
          updated_by = actor, client_updated_at = client_timestamp
      where id = target_id and homestead_id = tenant and version = expected_version
      returning * into current_task;
    else
      update public.tasks
      set record_id = (operation_payload ->> 'record_id')::uuid,
          title = operation_payload ->> 'title', description = operation_payload ->> 'description',
          status = operation_payload ->> 'status', priority = operation_payload ->> 'priority',
          available_from = (operation_payload ->> 'available_from')::date,
          due_date = (operation_payload ->> 'due_date')::date,
          recurrence_rule = nullif(operation_payload -> 'recurrence_rule', 'null'::jsonb),
          parent_task_id = (operation_payload ->> 'parent_task_id')::uuid,
          chore_window_id = (operation_payload ->> 'chore_window_id')::uuid,
          yield_type = operation_payload ->> 'yield_type', suggestion_key = operation_payload ->> 'suggestion_key',
          updated_by = actor, client_updated_at = client_timestamp
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

create or replace function private.retire_legacy_routine_foundation()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cleanup_time timestamptz := now();
begin
  perform set_config('regula.allow_deleted_state', 'true', true);

  update public.routine_occurrences
  set deleted_at = coalesce(deleted_at, cleanup_time), updated_at = cleanup_time
  where deleted_at is null;

  update public.routines
  set enabled = false, deleted_at = coalesce(deleted_at, cleanup_time), updated_at = cleanup_time
  where deleted_at is null;

  with legacy_series as (
    select distinct recurrence_rule ->> 'seriesId' as series_id
    from public.tasks
    where recurrence_rule ? 'routineType' or recurrence_rule ? 'migratedToRoutineId'
  )
  update public.tasks as task
  set recurrence_rule = jsonb_set(
        jsonb_set(coalesce(task.recurrence_rule, '{}'::jsonb), '{enabled}', 'false'::jsonb, true),
        '{seriesDeleted}', 'true'::jsonb, true
      ),
      deleted_at = case when task.status in ('open', 'in_progress') then coalesce(task.deleted_at, cleanup_time) else task.deleted_at end,
      updated_at = cleanup_time
  where task.recurrence_rule ? 'routineType'
     or task.recurrence_rule ? 'migratedToRoutineId'
     or task.recurrence_rule ->> 'seriesId' in (select series_id from legacy_series where series_id is not null);
end;
$$;

revoke all on function private.retire_legacy_routine_foundation() from public, anon, authenticated;
select private.retire_legacy_routine_foundation();
