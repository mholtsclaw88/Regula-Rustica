-- Sprint 7: atomic, idempotent optimistic writes for the local-first client.

alter table public.sync_operations add column response jsonb;

alter table public.task_assignments
  add column updated_at timestamptz not null default now(),
  add column version integer not null default 1 check (version > 0),
  add column client_updated_at timestamptz;

create index task_assignments_sync_cursor_idx
  on public.task_assignments (homestead_id, updated_at, id);

create trigger touch_task_assignments before update on public.task_assignments
  for each row execute function private.touch_row();

create or replace function private.sync_capability(target_table text, operation_kind text, payload jsonb)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  return case target_table
    when 'records' then case when operation_kind = 'create' then 'create_records' when operation_kind = 'soft_delete' then 'archive_records' when operation_kind = 'restore' then 'restore_records' else 'edit_records' end
    when 'record_relationships' then case when operation_kind = 'soft_delete' then 'archive_records' when operation_kind = 'restore' then 'restore_records' else 'edit_records' end
    when 'tasks' then case when operation_kind = 'update' and payload ->> 'status' = 'completed' then 'complete_tasks' else 'create_tasks' end
    when 'task_assignments' then 'assign_tasks'
    when 'chronicle_entries' then case when operation_kind = 'create' then 'record_events' else 'edit_recent_events' end
    when 'notes' then case when operation_kind = 'create' then 'add_notes' else 'edit_notes' end
    when 'ledger_entries' then 'manage_ledger'
    else null
  end;
end $$;

create or replace function public.apply_sync_operation(
  operation_key text,
  client_device_id uuid,
  target_table text,
  target_id uuid,
  operation_kind text,
  expected_version integer,
  client_timestamp timestamptz,
  operation_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.require_user();
  tenant uuid := public.current_homestead_id();
  required_capability text;
  request_digest text;
  prior public.sync_operations%rowtype;
  current_row jsonb;
  result jsonb;
  source_value public.entry_source;
  prior_task public.tasks%rowtype;
  next_due date;
  base_date date;
  every_n integer;
begin
  if tenant is null then raise exception 'Active Homestead membership required' using errcode = '42501'; end if;
  if operation_kind not in ('create','update','soft_delete','restore') then raise exception 'Unsupported sync operation' using errcode = '22023'; end if;
  if target_table not in ('records','record_relationships','tasks','task_assignments','chronicle_entries','notes','ledger_entries') then raise exception 'Unsupported sync table' using errcode = '22023'; end if;
  if operation_key is null or length(btrim(operation_key)) = 0 or client_device_id is null or target_id is null then raise exception 'Sync identity is required' using errcode = '22023'; end if;
  operation_payload := coalesce(operation_payload, '{}'::jsonb);
  if operation_payload ? 'id' and operation_payload ->> 'id' <> target_id::text then raise exception 'Payload ID does not match target ID' using errcode = '22023'; end if;

  request_digest := encode(extensions.digest(concat_ws(':', client_device_id, target_table, target_id, operation_kind,
    coalesce(expected_version::text, ''), coalesce(client_timestamp::text, ''), operation_payload::text), 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(concat_ws(':', tenant, actor, operation_key), 0));
  select * into prior from public.sync_operations
    where homestead_id = tenant and user_id = actor and idempotency_key = operation_key for update;
  if found then
    if prior.request_hash is distinct from request_digest then raise exception 'Idempotency key was reused for a different request' using errcode = '22023'; end if;
    return prior.response;
  end if;

  required_capability := private.sync_capability(target_table, operation_kind, operation_payload);
  if required_capability is null or not public.has_capability(required_capability) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if target_table = 'tasks' and operation_kind = 'update' and public.current_member_role() = 'hand' then
    if operation_payload ->> 'status' <> 'completed' or not exists (
      select 1 from public.task_assignments a join public.homestead_members m on m.id = a.member_id
      where a.task_id = target_id and a.homestead_id = tenant and a.removed_at is null and m.user_id = actor and m.status = 'active'
    ) then raise exception 'Task is not assigned to this member' using errcode = '42501'; end if;
  elsif target_table = 'tasks' and operation_kind = 'update' and public.current_member_role() not in ('steward','keeper') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  source_value := case when operation_payload ->> 'source' in ('manual','migration','import') then (operation_payload ->> 'source')::public.entry_source else 'manual' end;

  if operation_kind = 'create' then
    if target_table = 'records' then
      insert into public.records (id, homestead_id, type, name, status, identity, stewardship, created_by, updated_by, source, client_updated_at)
      values (target_id, tenant, operation_payload ->> 'type', operation_payload ->> 'name', operation_payload ->> 'status', coalesce(operation_payload -> 'identity','{}'), coalesce(operation_payload -> 'stewardship','{}'), actor, actor, source_value, client_timestamp)
      on conflict (id) do nothing returning to_jsonb(records.*) into current_row;
    elsif target_table = 'record_relationships' then
      insert into public.record_relationships (id, homestead_id, source_record_id, target_record_id, relationship_type, started_at, ended_at, details, created_by, updated_by, source, client_updated_at)
      values (target_id, tenant, (operation_payload ->> 'source_record_id')::uuid, (operation_payload ->> 'target_record_id')::uuid, operation_payload ->> 'relationship_type', (operation_payload ->> 'started_at')::timestamptz, (operation_payload ->> 'ended_at')::timestamptz, coalesce(operation_payload -> 'details','{}'), actor, actor, source_value, client_timestamp)
      on conflict (id) do nothing returning to_jsonb(record_relationships.*) into current_row;
    elsif target_table = 'tasks' then
      if operation_payload ->> 'status' = 'completed' then perform set_config('regula.allow_task_completion', 'true', true); end if;
      insert into public.tasks (id, homestead_id, record_id, title, description, status, priority, available_from, due_date, completed_at, completed_by, recurrence_rule, parent_task_id, created_by, updated_by, source, client_updated_at)
      values (target_id, tenant, (operation_payload ->> 'record_id')::uuid, operation_payload ->> 'title', operation_payload ->> 'description', coalesce(operation_payload ->> 'status','open'), coalesce(operation_payload ->> 'priority','normal'), (operation_payload ->> 'available_from')::date, (operation_payload ->> 'due_date')::date, (operation_payload ->> 'completed_at')::timestamptz, case when operation_payload ->> 'status' = 'completed' then actor end, nullif(operation_payload -> 'recurrence_rule','null'::jsonb), (operation_payload ->> 'parent_task_id')::uuid, actor, actor, source_value, client_timestamp)
      on conflict (id) do nothing returning to_jsonb(tasks.*) into current_row;
    elsif target_table = 'task_assignments' then
      insert into public.task_assignments (id, homestead_id, task_id, member_id, assignment_type, assigned_by, removed_at, client_updated_at)
      values (target_id, tenant, (operation_payload ->> 'task_id')::uuid, (operation_payload ->> 'member_id')::uuid, coalesce(operation_payload ->> 'assignment_type','assignee'), actor, (operation_payload ->> 'removed_at')::timestamptz, client_timestamp)
      on conflict (id) do nothing returning to_jsonb(task_assignments.*) into current_row;
    elsif target_table = 'chronicle_entries' then
      insert into public.chronicle_entries (id, homestead_id, record_id, task_id, event_type, occurred_at, summary, details, value, unit, corrects_entry_id, created_by, updated_by, source, client_updated_at)
      values (target_id, tenant, (operation_payload ->> 'record_id')::uuid, (operation_payload ->> 'task_id')::uuid, operation_payload ->> 'event_type', (operation_payload ->> 'occurred_at')::timestamptz, operation_payload ->> 'summary', coalesce(operation_payload -> 'details','{}'), (operation_payload ->> 'value')::numeric, operation_payload ->> 'unit', (operation_payload ->> 'corrects_entry_id')::uuid, actor, actor, source_value, client_timestamp)
      on conflict (id) do nothing returning to_jsonb(chronicle_entries.*) into current_row;
    elsif target_table = 'notes' then
      insert into public.notes (id, homestead_id, record_id, title, body, pinned, created_by, updated_by, source, client_updated_at)
      values (target_id, tenant, (operation_payload ->> 'record_id')::uuid, operation_payload ->> 'title', operation_payload ->> 'body', coalesce((operation_payload ->> 'pinned')::boolean,false), actor, actor, source_value, client_timestamp)
      on conflict (id) do nothing returning to_jsonb(notes.*) into current_row;
    else
      insert into public.ledger_entries (id, homestead_id, record_id, entry_type, entry_date, description, amount, currency_code, category, vendor_or_source, created_by, updated_by, source, client_updated_at)
      values (target_id, tenant, (operation_payload ->> 'record_id')::uuid, operation_payload ->> 'entry_type', (operation_payload ->> 'entry_date')::date, operation_payload ->> 'description', (operation_payload ->> 'amount')::numeric, coalesce(operation_payload ->> 'currency_code','USD'), operation_payload ->> 'category', operation_payload ->> 'vendor_or_source', actor, actor, source_value, client_timestamp)
      on conflict (id) do nothing returning to_jsonb(ledger_entries.*) into current_row;
    end if;
    if current_row is null then
      execute format('select to_jsonb(t.*) from public.%I t where t.id = $1 and t.homestead_id = $2', target_table) into current_row using target_id, tenant;
      result := jsonb_build_object('status','conflict','row',current_row);
    else result := jsonb_build_object('status','applied','row',current_row); end if;
  else
    if expected_version is null then raise exception 'Expected version is required' using errcode = '22023'; end if;
    if operation_kind in ('soft_delete','restore') then
      if target_table = 'task_assignments' then
        update public.task_assignments set removed_at = case when operation_kind = 'restore' then null else now() end, client_updated_at = client_timestamp
          where id = target_id and homestead_id = tenant and version = expected_version returning to_jsonb(task_assignments.*) into current_row;
      else
        perform set_config('regula.allow_deleted_state', 'true', true);
        execute format('update public.%I t set deleted_at = $1, deleted_by = $2, updated_by = $2, client_updated_at = $3 where id = $4 and homestead_id = $5 and version = $6 returning to_jsonb(t.*)', target_table)
          into current_row using case when operation_kind = 'restore' then null else now() end, case when operation_kind = 'restore' then null else actor end, client_timestamp, target_id, tenant, expected_version;
      end if;
    elsif target_table = 'records' then
      update public.records set type = operation_payload ->> 'type', name = operation_payload ->> 'name', status = operation_payload ->> 'status', identity = coalesce(operation_payload -> 'identity','{}'), stewardship = coalesce(operation_payload -> 'stewardship','{}'), updated_by = actor, client_updated_at = client_timestamp
        where id = target_id and homestead_id = tenant and version = expected_version returning to_jsonb(records.*) into current_row;
    elsif target_table = 'record_relationships' then
      update public.record_relationships set source_record_id = (operation_payload ->> 'source_record_id')::uuid, target_record_id = (operation_payload ->> 'target_record_id')::uuid, relationship_type = operation_payload ->> 'relationship_type', started_at = (operation_payload ->> 'started_at')::timestamptz, ended_at = (operation_payload ->> 'ended_at')::timestamptz, details = coalesce(operation_payload -> 'details','{}'), updated_by = actor, client_updated_at = client_timestamp
        where id = target_id and homestead_id = tenant and version = expected_version returning to_jsonb(record_relationships.*) into current_row;
    elsif target_table = 'tasks' then
      select * into prior_task from public.tasks where id = target_id and homestead_id = tenant;
      if operation_payload ->> 'status' = 'completed' then perform set_config('regula.allow_task_completion', 'true', true); end if;
      update public.tasks set record_id = (operation_payload ->> 'record_id')::uuid, title = operation_payload ->> 'title', description = operation_payload ->> 'description', status = operation_payload ->> 'status', priority = operation_payload ->> 'priority', available_from = (operation_payload ->> 'available_from')::date, due_date = (operation_payload ->> 'due_date')::date, completed_at = (operation_payload ->> 'completed_at')::timestamptz, completed_by = case when operation_payload ->> 'status' = 'completed' then actor else null end, recurrence_rule = nullif(operation_payload -> 'recurrence_rule','null'::jsonb), parent_task_id = (operation_payload ->> 'parent_task_id')::uuid, updated_by = actor, client_updated_at = client_timestamp
        where id = target_id and homestead_id = tenant and version = expected_version returning to_jsonb(tasks.*) into current_row;
      if current_row is not null and prior_task.status <> 'completed' and operation_payload ->> 'status' = 'completed' and prior_task.recurrence_rule is not null then
        every_n := greatest(coalesce((prior_task.recurrence_rule ->> 'interval')::integer, 1), 1);
        base_date := case when prior_task.recurrence_rule ->> 'mode' = 'after_completion' then current_date else coalesce(prior_task.due_date, current_date) end;
        next_due := case prior_task.recurrence_rule ->> 'frequency'
          when 'daily' then base_date + every_n
          when 'weekly' then base_date + (7 * every_n)
          when 'monthly' then (base_date + make_interval(months => every_n))::date
          else null end;
        if next_due is null then raise exception 'Unsupported recurrence frequency' using errcode = '22023'; end if;
        insert into public.tasks (homestead_id, record_id, parent_task_id, title, description, status, priority, due_date, recurrence_rule, created_by, updated_by, source)
        values (tenant, prior_task.record_id, prior_task.id, prior_task.title, prior_task.description, 'open', prior_task.priority, next_due, prior_task.recurrence_rule, actor, actor, 'system');
      end if;
    elsif target_table = 'task_assignments' then
      update public.task_assignments set task_id = (operation_payload ->> 'task_id')::uuid, member_id = (operation_payload ->> 'member_id')::uuid, assignment_type = operation_payload ->> 'assignment_type', removed_at = (operation_payload ->> 'removed_at')::timestamptz, client_updated_at = client_timestamp
        where id = target_id and homestead_id = tenant and version = expected_version returning to_jsonb(task_assignments.*) into current_row;
    elsif target_table = 'chronicle_entries' then
      update public.chronicle_entries set record_id = (operation_payload ->> 'record_id')::uuid, task_id = (operation_payload ->> 'task_id')::uuid, event_type = operation_payload ->> 'event_type', occurred_at = (operation_payload ->> 'occurred_at')::timestamptz, summary = operation_payload ->> 'summary', details = coalesce(operation_payload -> 'details','{}'), value = (operation_payload ->> 'value')::numeric, unit = operation_payload ->> 'unit', corrects_entry_id = (operation_payload ->> 'corrects_entry_id')::uuid, updated_by = actor, client_updated_at = client_timestamp
        where id = target_id and homestead_id = tenant and version = expected_version returning to_jsonb(chronicle_entries.*) into current_row;
    elsif target_table = 'notes' then
      update public.notes set record_id = (operation_payload ->> 'record_id')::uuid, title = operation_payload ->> 'title', body = operation_payload ->> 'body', pinned = coalesce((operation_payload ->> 'pinned')::boolean,false), updated_by = actor, client_updated_at = client_timestamp
        where id = target_id and homestead_id = tenant and version = expected_version returning to_jsonb(notes.*) into current_row;
    else
      update public.ledger_entries set record_id = (operation_payload ->> 'record_id')::uuid, entry_type = operation_payload ->> 'entry_type', entry_date = (operation_payload ->> 'entry_date')::date, description = operation_payload ->> 'description', amount = (operation_payload ->> 'amount')::numeric, currency_code = operation_payload ->> 'currency_code', category = operation_payload ->> 'category', vendor_or_source = operation_payload ->> 'vendor_or_source', updated_by = actor, client_updated_at = client_timestamp
        where id = target_id and homestead_id = tenant and version = expected_version returning to_jsonb(ledger_entries.*) into current_row;
    end if;
    if current_row is null then
      execute format('select to_jsonb(t.*) from public.%I t where t.id = $1 and t.homestead_id = $2', target_table) into current_row using target_id, tenant;
      result := jsonb_build_object('status','conflict','row',current_row);
    else result := jsonb_build_object('status','applied','row',current_row); end if;
  end if;

  insert into public.sync_operations (homestead_id, user_id, device_id, idempotency_key, operation_type, table_name, row_id, request_hash, status, response, processed_at)
  values (tenant, actor, client_device_id, operation_key, operation_kind, target_table, target_id, request_digest, 'processed', result, now());
  return result;
end $$;

revoke execute on function private.sync_capability(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.apply_sync_operation(text, uuid, text, uuid, text, integer, timestamptz, jsonb) from public, anon;
grant execute on function public.apply_sync_operation(text, uuid, text, uuid, text, integer, timestamptz, jsonb) to authenticated;
