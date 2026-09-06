alter table public.calendar_events
  add column recurrence_rule jsonb
  check (
    recurrence_rule is null or (
      jsonb_typeof(recurrence_rule) = 'object'
      and recurrence_rule ->> 'frequency' in ('daily', 'weekly', 'monthly')
      and recurrence_rule ->> 'interval' ~ '^[1-9][0-9]*$'
      and (not recurrence_rule ? 'until' or recurrence_rule ->> 'until' ~ '^\d{4}-\d{2}-\d{2}$')
    )
  );

create or replace function public.apply_housekeeping_sync_operation(
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
  capability text;
  request_digest text;
  prior public.sync_operations%rowtype;
  current_row jsonb;
  result jsonb;
  source_value public.entry_source;
begin
  if tenant is null then raise exception 'Active Homestead membership required' using errcode = '42501'; end if;
  if target_table not in ('calendar_events', 'yield_entries') or operation_kind not in ('create','update','soft_delete','restore') then
    raise exception 'Unsupported housekeeping sync operation' using errcode = '22023';
  end if;
  if operation_key is null or length(btrim(operation_key)) = 0 or client_device_id is null or target_id is null then
    raise exception 'Sync identity is required' using errcode = '22023';
  end if;
  operation_payload := coalesce(operation_payload, '{}'::jsonb);
  if operation_payload ? 'id' and operation_payload ->> 'id' <> target_id::text then raise exception 'Payload ID does not match target ID' using errcode = '22023'; end if;
  capability := case when target_table = 'calendar_events' then 'create_tasks'
    when operation_kind = 'create' then 'record_events' else 'edit_recent_events' end;
  if not public.has_capability(capability) then raise exception 'Not authorized' using errcode = '42501'; end if;

  request_digest := encode(extensions.digest(concat_ws(':', client_device_id, target_table, target_id, operation_kind,
    coalesce(expected_version::text, ''), coalesce(client_timestamp::text, ''), operation_payload::text), 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(concat_ws(':', tenant, actor, operation_key), 0));
  select * into prior from public.sync_operations where homestead_id = tenant and user_id = actor and idempotency_key = operation_key for update;
  if found then
    if prior.request_hash is distinct from request_digest then raise exception 'Idempotency key was reused for a different request' using errcode = '22023'; end if;
    return prior.response;
  end if;
  source_value := case when operation_payload ->> 'source' in ('manual','migration','import') then (operation_payload ->> 'source')::public.entry_source else 'manual' end;

  if operation_kind = 'create' then
    if target_table = 'calendar_events' then
      insert into public.calendar_events (id, homestead_id, record_id, title, start_date, end_date, all_day, start_time, end_time, location, notes, recurrence_rule, created_by, updated_by, source, client_updated_at)
      values (target_id, tenant, (operation_payload ->> 'record_id')::uuid, operation_payload ->> 'title', (operation_payload ->> 'start_date')::date,
        (operation_payload ->> 'end_date')::date, coalesce((operation_payload ->> 'all_day')::boolean, true), (operation_payload ->> 'start_time')::time,
        (operation_payload ->> 'end_time')::time, operation_payload ->> 'location', operation_payload ->> 'notes', nullif(operation_payload -> 'recurrence_rule', 'null'::jsonb), actor, actor, source_value, client_timestamp)
      on conflict (id) do nothing returning to_jsonb(calendar_events.*) into current_row;
    else
      insert into public.yield_entries (id, homestead_id, record_id, yield_type, occurred_at, session, quantity, unit, unusable_quantity, details, created_by, updated_by, source, client_updated_at)
      values (target_id, tenant, (operation_payload ->> 'record_id')::uuid, operation_payload ->> 'yield_type', (operation_payload ->> 'occurred_at')::timestamptz,
        coalesce(operation_payload ->> 'session', 'other'), (operation_payload ->> 'quantity')::numeric, operation_payload ->> 'unit',
        coalesce((operation_payload ->> 'unusable_quantity')::numeric, 0), coalesce(operation_payload -> 'details', '{}'), actor, actor, source_value, client_timestamp)
      on conflict (id) do nothing returning to_jsonb(yield_entries.*) into current_row;
    end if;
  else
    if expected_version is null then raise exception 'Expected version is required' using errcode = '22023'; end if;
    if operation_kind in ('soft_delete', 'restore') then
      perform set_config('regula.allow_deleted_state', 'true', true);
      execute format('update public.%I t set deleted_at = $1, deleted_by = $2, updated_by = $2, client_updated_at = $3 where id = $4 and homestead_id = $5 and version = $6 returning to_jsonb(t.*)', target_table)
        into current_row using case when operation_kind = 'restore' then null else now() end,
        case when operation_kind = 'restore' then null else actor end, client_timestamp, target_id, tenant, expected_version;
    elsif target_table = 'calendar_events' then
      update public.calendar_events set record_id = (operation_payload ->> 'record_id')::uuid, title = operation_payload ->> 'title',
        start_date = (operation_payload ->> 'start_date')::date, end_date = (operation_payload ->> 'end_date')::date,
        all_day = coalesce((operation_payload ->> 'all_day')::boolean, true), start_time = (operation_payload ->> 'start_time')::time,
        end_time = (operation_payload ->> 'end_time')::time, location = operation_payload ->> 'location', notes = operation_payload ->> 'notes',
        recurrence_rule = nullif(operation_payload -> 'recurrence_rule', 'null'::jsonb), updated_by = actor, client_updated_at = client_timestamp
      where id = target_id and homestead_id = tenant and version = expected_version returning to_jsonb(calendar_events.*) into current_row;
    else
      update public.yield_entries set record_id = (operation_payload ->> 'record_id')::uuid, yield_type = operation_payload ->> 'yield_type',
        occurred_at = (operation_payload ->> 'occurred_at')::timestamptz, session = operation_payload ->> 'session',
        quantity = (operation_payload ->> 'quantity')::numeric, unit = operation_payload ->> 'unit',
        unusable_quantity = coalesce((operation_payload ->> 'unusable_quantity')::numeric, 0), details = coalesce(operation_payload -> 'details', '{}'),
        updated_by = actor, client_updated_at = client_timestamp
      where id = target_id and homestead_id = tenant and version = expected_version returning to_jsonb(yield_entries.*) into current_row;
    end if;
  end if;

  if current_row is null then
    execute format('select to_jsonb(t.*) from public.%I t where t.id = $1 and t.homestead_id = $2', target_table)
      into current_row using target_id, tenant;
    result := jsonb_build_object('status', 'conflict', 'row', current_row);
  else
    result := jsonb_build_object('status', 'applied', 'row', current_row);
  end if;
  insert into public.sync_operations (homestead_id, user_id, device_id, idempotency_key, operation_type, table_name, row_id, request_hash, status, response, processed_at)
  values (tenant, actor, client_device_id, operation_key, operation_kind, target_table, target_id, request_digest, 'processed', result, now());
  return result;
end $$;

revoke execute on function public.apply_housekeeping_sync_operation(text, uuid, text, uuid, text, integer, timestamptz, jsonb) from public, anon;
grant execute on function public.apply_housekeeping_sync_operation(text, uuid, text, uuid, text, integer, timestamptz, jsonb) to authenticated;
