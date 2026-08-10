-- Housekeeping sprint: shared calendar and canonical Homestead yield.
-- Task date windows already exist in the adopted schema and remain unchanged.

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  record_id uuid references public.records(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 240),
  start_date date not null,
  end_date date not null,
  all_day boolean not null default true,
  start_time time,
  end_time time,
  location text,
  notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  source public.entry_source not null default 'manual', schema_version integer not null default 1 check (schema_version > 0),
  version integer not null default 1 check (version > 0), client_updated_at timestamptz,
  deleted_at timestamptz, deleted_by uuid references auth.users(id) on delete set null,
  check (end_date >= start_date),
  check (not all_day or (start_time is null and end_time is null)),
  check (end_date > start_date or start_time is null or end_time is null or end_time >= start_time)
);

create table public.yield_entries (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  record_id uuid not null references public.records(id) on delete restrict,
  yield_type text not null check (yield_type in ('milk', 'eggs')),
  occurred_at timestamptz not null,
  session text not null default 'other' check (session in ('morning', 'evening', 'other')),
  quantity numeric not null check (quantity > 0),
  unit text not null check (length(btrim(unit)) between 1 and 30),
  unusable_quantity numeric not null default 0 check (unusable_quantity >= 0 and unusable_quantity <= quantity),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  source public.entry_source not null default 'manual', schema_version integer not null default 1 check (schema_version > 0),
  version integer not null default 1 check (version > 0), client_updated_at timestamptz,
  deleted_at timestamptz, deleted_by uuid references auth.users(id) on delete set null,
  check (yield_type <> 'eggs' or unit = 'eggs')
);

create index calendar_events_homestead_date_idx on public.calendar_events (homestead_id, start_date, end_date) where deleted_at is null;
create index calendar_events_record_idx on public.calendar_events (record_id, start_date) where deleted_at is null;
create index calendar_events_sync_cursor_idx on public.calendar_events (homestead_id, updated_at, id);
create index yield_entries_homestead_occurred_idx on public.yield_entries (homestead_id, occurred_at desc) where deleted_at is null;
create index yield_entries_record_occurred_idx on public.yield_entries (record_id, occurred_at desc) where deleted_at is null;
create index yield_entries_sync_cursor_idx on public.yield_entries (homestead_id, updated_at, id);

create or replace function private.validate_housekeeping_homestead()
returns trigger language plpgsql set search_path = '' as $$
declare linked_tenant uuid;
begin
  if new.record_id is not null then
    select r.homestead_id into linked_tenant from public.records r where r.id = new.record_id;
    if linked_tenant is distinct from new.homestead_id then
      raise exception 'Record belongs to another Homestead' using errcode = '23503';
    end if;
  end if;
  return new;
end $$;

create trigger validate_calendar_homestead before insert or update on public.calendar_events
  for each row execute function private.validate_housekeeping_homestead();
create trigger validate_yield_homestead before insert or update on public.yield_entries
  for each row execute function private.validate_housekeeping_homestead();
create trigger touch_calendar_events before update on public.calendar_events
  for each row execute function private.touch_row();
create trigger touch_yield_entries before update on public.yield_entries
  for each row execute function private.touch_row();
create trigger protect_content_calendar_events before insert or update on public.calendar_events
  for each row execute function private.protect_content_fields();
create trigger protect_content_yield_entries before insert or update on public.yield_entries
  for each row execute function private.protect_content_fields();
create trigger audit_calendar_events after insert or update on public.calendar_events
  for each row execute function private.audit_row();
create trigger audit_yield_entries after insert or update on public.yield_entries
  for each row execute function private.audit_row();

alter table public.calendar_events enable row level security;
alter table public.yield_entries enable row level security;

create policy calendar_select on public.calendar_events for select to authenticated
  using (homestead_id = public.current_homestead_id() and public.has_capability('view_records'));
create policy calendar_insert on public.calendar_events for insert to authenticated
  with check (homestead_id = public.current_homestead_id() and created_by = (select auth.uid()) and public.has_capability('create_tasks'));
create policy calendar_update on public.calendar_events for update to authenticated
  using (homestead_id = public.current_homestead_id() and public.has_capability('create_tasks'))
  with check (homestead_id = public.current_homestead_id() and public.has_capability('create_tasks'));

create policy yield_select on public.yield_entries for select to authenticated
  using (homestead_id = public.current_homestead_id() and public.has_capability('view_records'));
create policy yield_insert on public.yield_entries for insert to authenticated
  with check (homestead_id = public.current_homestead_id() and created_by = (select auth.uid()) and public.has_capability('record_events'));
create policy yield_update on public.yield_entries for update to authenticated
  using (homestead_id = public.current_homestead_id() and public.has_capability('edit_recent_events'))
  with check (homestead_id = public.current_homestead_id() and public.has_capability('edit_recent_events'));

revoke all on public.calendar_events, public.yield_entries from public, anon, authenticated;
grant select, insert, update on public.calendar_events, public.yield_entries to authenticated;

create or replace function private.change_housekeeping_deleted_state(target_table text, target_id uuid, restore boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.require_user();
  tenant uuid := public.current_homestead_id();
  capability text := case when target_table = 'calendar_events' then 'create_tasks' else 'edit_recent_events' end;
begin
  if target_table not in ('calendar_events', 'yield_entries') then raise exception 'Unsupported table' using errcode = '22023'; end if;
  if tenant is null or not public.has_capability(capability) then raise exception 'Not authorized' using errcode = '42501'; end if;
  perform set_config('regula.allow_deleted_state', 'true', true);
  execute format('update public.%I set deleted_at = $1, deleted_by = $2, updated_by = $2 where id = $3 and homestead_id = $4', target_table)
    using case when restore then null else now() end, case when restore then null else actor end, target_id, tenant;
  if not found then raise exception 'Row not found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.soft_delete_row(target_table text, target_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if target_table in ('calendar_events', 'yield_entries') then
    perform private.change_housekeeping_deleted_state(target_table, target_id, false);
  else
    perform private.change_deleted_state(target_table, target_id, false);
  end if;
end $$;

create or replace function public.restore_row(target_table text, target_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if target_table in ('calendar_events', 'yield_entries') then
    perform private.change_housekeeping_deleted_state(target_table, target_id, true);
  else
    perform private.change_deleted_state(target_table, target_id, true);
  end if;
end $$;

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
      insert into public.calendar_events (id, homestead_id, record_id, title, start_date, end_date, all_day, start_time, end_time, location, notes, created_by, updated_by, source, client_updated_at)
      values (target_id, tenant, (operation_payload ->> 'record_id')::uuid, operation_payload ->> 'title', (operation_payload ->> 'start_date')::date,
        (operation_payload ->> 'end_date')::date, coalesce((operation_payload ->> 'all_day')::boolean, true), (operation_payload ->> 'start_time')::time,
        (operation_payload ->> 'end_time')::time, operation_payload ->> 'location', operation_payload ->> 'notes', actor, actor, source_value, client_timestamp)
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
        updated_by = actor, client_updated_at = client_timestamp
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

revoke execute on function private.validate_housekeeping_homestead() from public, anon, authenticated;
revoke execute on function private.change_housekeeping_deleted_state(text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.apply_housekeeping_sync_operation(text, uuid, text, uuid, text, integer, timestamptz, jsonb) from public, anon;
grant execute on function public.apply_housekeeping_sync_operation(text, uuid, text, uuid, text, integer, timestamptz, jsonb) to authenticated;
