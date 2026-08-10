-- Assignable Homestead people. Account-backed members and children share one
-- task-facing directory, but only members participate in authentication or RLS.

create table public.homestead_people (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  member_id uuid unique references public.homestead_members(id) on delete restrict,
  person_type text not null check (person_type in ('member', 'child')),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  source public.entry_source not null default 'manual', schema_version integer not null default 1 check (schema_version > 0),
  version integer not null default 1 check (version > 0), client_updated_at timestamptz,
  deleted_at timestamptz, deleted_by uuid references auth.users(id) on delete set null,
  check ((person_type = 'member' and member_id is not null) or (person_type = 'child' and member_id is null))
);

create index homestead_people_active_idx on public.homestead_people (homestead_id, lower(display_name)) where deleted_at is null;
create index homestead_people_sync_cursor_idx on public.homestead_people (homestead_id, updated_at, id);

insert into public.homestead_people (homestead_id, member_id, person_type, display_name, source, deleted_at)
select m.homestead_id, m.id, 'member', coalesce(p.display_name, 'Member'), 'system',
  case when m.status = 'active' then null else coalesce(m.removed_at, now()) end
from public.homestead_members m
left join public.profiles p on p.id = m.user_id
on conflict (member_id) do nothing;

alter table public.task_assignments
  add column person_id uuid references public.homestead_people(id) on delete restrict;

update public.task_assignments a
set person_id = p.id
from public.homestead_people p
where p.member_id = a.member_id;

alter table public.task_assignments
  alter column person_id set not null,
  alter column member_id drop not null;

drop index public.task_assignments_active_unique_idx;
create unique index task_assignments_active_unique_idx
  on public.task_assignments (task_id, person_id) where removed_at is null;
create index task_assignments_person_idx
  on public.task_assignments (person_id, assigned_at) where removed_at is null;

create or replace function private.validate_person_assignment()
returns trigger language plpgsql set search_path = '' as $$
declare
  task_tenant uuid;
  person_tenant uuid;
  linked_person uuid;
  linked_member uuid;
  person_deleted_at timestamptz;
begin
  select t.homestead_id into task_tenant from public.tasks t where t.id = new.task_id;
  if task_tenant is distinct from new.homestead_id then
    raise exception 'Task belongs to another Homestead' using errcode = '23503';
  end if;
  select p.id, p.homestead_id, p.member_id, p.deleted_at
    into linked_person, person_tenant, linked_member, person_deleted_at
  from public.homestead_people p
  where p.id = new.person_id or (new.person_id is null and p.member_id = new.member_id);
  if person_tenant is distinct from new.homestead_id or person_deleted_at is not null then
    raise exception 'Assignee does not belong to this Homestead' using errcode = '23503';
  end if;
  new.person_id := linked_person;
  new.member_id := linked_member;
  return new;
end $$;

drop trigger validate_assignment_homestead on public.task_assignments;
create trigger validate_assignment_homestead before insert or update on public.task_assignments
  for each row execute function private.validate_person_assignment();

create or replace function private.sync_member_person()
returns trigger language plpgsql security definer set search_path = '' as $$
declare member_name text;
begin
  if new.status = 'active' then
    select p.display_name into member_name from public.profiles p where p.id = new.user_id;
    insert into public.homestead_people (homestead_id, member_id, person_type, display_name, source)
    values (new.homestead_id, new.id, 'member', coalesce(member_name, 'Member'), 'system')
    on conflict (member_id) do update set
      homestead_id = excluded.homestead_id,
      display_name = excluded.display_name,
      deleted_at = null,
      deleted_by = null,
      updated_at = now();
  else
    update public.homestead_people
      set deleted_at = coalesce(deleted_at, now()), updated_at = now()
      where member_id = new.id;
  end if;
  return new;
end $$;

create trigger sync_member_person after insert or update of status on public.homestead_members
  for each row execute function private.sync_member_person();
create trigger touch_homestead_people before update on public.homestead_people
  for each row execute function private.touch_row();
create trigger protect_content_homestead_people before insert or update on public.homestead_people
  for each row execute function private.protect_content_fields();
create trigger audit_homestead_people after insert or update on public.homestead_people
  for each row execute function private.audit_row();

alter table public.homestead_people enable row level security;

create policy people_select on public.homestead_people for select to authenticated
  using (homestead_id = public.current_homestead_id() and public.has_capability('view_records'));
create policy people_insert on public.homestead_people for insert to authenticated
  with check (
    homestead_id = public.current_homestead_id()
    and created_by = (select auth.uid())
    and public.has_capability('assign_tasks')
    and person_type = 'child'
    and member_id is null
  );
create policy people_update on public.homestead_people for update to authenticated
  using (homestead_id = public.current_homestead_id() and public.has_capability('assign_tasks') and person_type = 'child' and member_id is null)
  with check (homestead_id = public.current_homestead_id() and public.has_capability('assign_tasks') and person_type = 'child' and member_id is null);

revoke all on public.homestead_people from public, anon, authenticated;
grant select, insert, update on public.homestead_people to authenticated;

create or replace function private.change_person_deleted_state(target_id uuid, restore boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_user(); tenant uuid := public.current_homestead_id();
begin
  if tenant is null or not public.has_capability('assign_tasks') then raise exception 'Not authorized' using errcode = '42501'; end if;
  perform set_config('regula.allow_deleted_state', 'true', true);
  update public.homestead_people set
    deleted_at = case when restore then null else now() end,
    deleted_by = case when restore then null else actor end,
    updated_by = actor
  where id = target_id and homestead_id = tenant and person_type = 'child';
  if not found then raise exception 'Child profile not found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.soft_delete_row(target_table text, target_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if target_table = 'homestead_people' then
    perform private.change_person_deleted_state(target_id, false);
  elsif target_table in ('calendar_events', 'yield_entries') then
    perform private.change_housekeeping_deleted_state(target_table, target_id, false);
  else
    perform private.change_deleted_state(target_table, target_id, false);
  end if;
end $$;

create or replace function public.restore_row(target_table text, target_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if target_table = 'homestead_people' then
    perform private.change_person_deleted_state(target_id, true);
  elsif target_table in ('calendar_events', 'yield_entries') then
    perform private.change_housekeeping_deleted_state(target_table, target_id, true);
  else
    perform private.change_deleted_state(target_table, target_id, true);
  end if;
end $$;

create or replace function public.apply_people_sync_operation(
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
  request_digest text;
  prior public.sync_operations%rowtype;
  current_row jsonb;
  result jsonb;
  source_value public.entry_source;
  selected_person public.homestead_people%rowtype;
begin
  if tenant is null or not public.has_capability('assign_tasks') then raise exception 'Not authorized' using errcode = '42501'; end if;
  if target_table not in ('homestead_people', 'task_assignments') or operation_kind not in ('create','update','soft_delete','restore') then
    raise exception 'Unsupported people sync operation' using errcode = '22023';
  end if;
  if operation_key is null or length(btrim(operation_key)) = 0 or client_device_id is null or target_id is null then
    raise exception 'Sync identity is required' using errcode = '22023';
  end if;
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
  source_value := case when operation_payload ->> 'source' in ('manual','migration','import') then (operation_payload ->> 'source')::public.entry_source else 'manual' end;

  if operation_kind = 'create' then
    if target_table = 'homestead_people' then
      if coalesce(operation_payload ->> 'person_type', 'child') <> 'child' or operation_payload ->> 'member_id' is not null then
        raise exception 'Only child profiles may be created by the client' using errcode = '42501';
      end if;
      insert into public.homestead_people (id, homestead_id, person_type, display_name, created_by, updated_by, source, client_updated_at)
      values (target_id, tenant, 'child', btrim(operation_payload ->> 'display_name'), actor, actor, source_value, client_timestamp)
      on conflict (id) do nothing returning to_jsonb(homestead_people.*) into current_row;
    else
      select * into selected_person from public.homestead_people
        where homestead_id = tenant and deleted_at is null
          and (id = (operation_payload ->> 'person_id')::uuid
            or (operation_payload ->> 'person_id' is null and member_id = (operation_payload ->> 'member_id')::uuid));
      if not found then raise exception 'Assignee not found' using errcode = '23503'; end if;
      insert into public.task_assignments (id, homestead_id, task_id, person_id, member_id, assignment_type, assigned_by, removed_at, client_updated_at)
      values (target_id, tenant, (operation_payload ->> 'task_id')::uuid, selected_person.id, selected_person.member_id,
        coalesce(operation_payload ->> 'assignment_type','assignee'), actor, (operation_payload ->> 'removed_at')::timestamptz, client_timestamp)
      on conflict (id) do nothing returning to_jsonb(task_assignments.*) into current_row;
    end if;
  else
    if expected_version is null then raise exception 'Expected version is required' using errcode = '22023'; end if;
    if operation_kind in ('soft_delete','restore') then
      if target_table = 'homestead_people' then
        perform set_config('regula.allow_deleted_state', 'true', true);
        update public.homestead_people set
          deleted_at = case when operation_kind = 'restore' then null else now() end,
          deleted_by = case when operation_kind = 'restore' then null else actor end,
          updated_by = actor, client_updated_at = client_timestamp
        where id = target_id and homestead_id = tenant and person_type = 'child' and version = expected_version
        returning to_jsonb(homestead_people.*) into current_row;
      else
        update public.task_assignments set removed_at = case when operation_kind = 'restore' then null else now() end,
          client_updated_at = client_timestamp
        where id = target_id and homestead_id = tenant and version = expected_version
        returning to_jsonb(task_assignments.*) into current_row;
      end if;
    elsif target_table = 'homestead_people' then
      update public.homestead_people set display_name = btrim(operation_payload ->> 'display_name'), updated_by = actor, client_updated_at = client_timestamp
      where id = target_id and homestead_id = tenant and person_type = 'child' and version = expected_version
      returning to_jsonb(homestead_people.*) into current_row;
    else
      select * into selected_person from public.homestead_people
        where homestead_id = tenant and deleted_at is null
          and (id = (operation_payload ->> 'person_id')::uuid
            or (operation_payload ->> 'person_id' is null and member_id = (operation_payload ->> 'member_id')::uuid));
      if not found then raise exception 'Assignee not found' using errcode = '23503'; end if;
      update public.task_assignments set task_id = (operation_payload ->> 'task_id')::uuid,
        person_id = selected_person.id, member_id = selected_person.member_id,
        assignment_type = coalesce(operation_payload ->> 'assignment_type','assignee'),
        removed_at = (operation_payload ->> 'removed_at')::timestamptz, client_updated_at = client_timestamp
      where id = target_id and homestead_id = tenant and version = expected_version
      returning to_jsonb(task_assignments.*) into current_row;
    end if;
  end if;

  if current_row is null then
    execute format('select to_jsonb(t.*) from public.%I t where t.id = $1 and t.homestead_id = $2', target_table)
      into current_row using target_id, tenant;
    result := jsonb_build_object('status','conflict','row',current_row);
  else result := jsonb_build_object('status','applied','row',current_row); end if;
  insert into public.sync_operations (homestead_id, user_id, device_id, idempotency_key, operation_type, table_name, row_id, request_hash, status, response, processed_at)
  values (tenant, actor, client_device_id, operation_key, operation_kind, target_table, target_id, request_digest, 'processed', result, now());
  return result;
end $$;

revoke execute on function private.validate_person_assignment() from public, anon, authenticated;
revoke execute on function private.sync_member_person() from public, anon, authenticated;
revoke execute on function private.change_person_deleted_state(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.apply_people_sync_operation(text, uuid, text, uuid, text, integer, timestamptz, jsonb) from public, anon;
grant execute on function public.apply_people_sync_operation(text, uuid, text, uuid, text, integer, timestamptz, jsonb) to authenticated;
