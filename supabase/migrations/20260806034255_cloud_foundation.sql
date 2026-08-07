-- Regula Rustica Cloud Foundation
-- The migration is intentionally atomic: tables are not exposed before their
-- row-level security policies and grants exist.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.member_role as enum ('steward', 'keeper', 'hand', 'guest');
create type public.member_status as enum ('active', 'suspended', 'removed');
create type public.entry_source as enum ('manual', 'cellarer', 'migration', 'import', 'system');

create table public.homesteads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  slug text unique,
  timezone text not null default 'America/New_York',
  currency_code char(3) not null default 'USD' check (currency_code ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.homestead_members (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null,
  status public.member_status not null default 'active',
  joined_at timestamptz,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users(id) on delete set null,
  unique (homestead_id, user_id),
  check ((status = 'active' and joined_at is not null and removed_at is null)
      or (status = 'suspended' and joined_at is not null and removed_at is null)
      or (status = 'removed' and removed_at is not null))
);

create unique index homestead_members_one_active_homestead_idx
  on public.homestead_members (user_id) where status = 'active';
create index homestead_members_homestead_active_idx
  on public.homestead_members (homestead_id, role) where status = 'active';

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  email_normalized text not null check (email_normalized = lower(btrim(email_normalized))),
  role public.member_role not null check (role <> 'steward'),
  token_hash text not null unique check (length(token_hash) = 64),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  invited_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (accepted_at is null or revoked_at is null)
);

create unique index invitations_one_pending_email_idx
  on public.invitations (homestead_id, email_normalized)
  where accepted_at is null and revoked_at is null;

-- Synchronized tables use the same durable metadata contract.
create table public.records (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  type text not null check (type in ('animal', 'land', 'equipment', 'structure', 'work')),
  name text not null check (length(btrim(name)) between 1 and 200),
  status text not null default 'active',
  identity jsonb not null default '{}'::jsonb check (jsonb_typeof(identity) = 'object'),
  stewardship jsonb not null default '{}'::jsonb check (jsonb_typeof(stewardship) = 'object'),
  primary_photo_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  source public.entry_source not null default 'manual', schema_version integer not null default 1 check (schema_version > 0),
  version integer not null default 1 check (version > 0), client_updated_at timestamptz,
  deleted_at timestamptz, deleted_by uuid references auth.users(id) on delete set null
);

create table public.record_relationships (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  source_record_id uuid not null references public.records(id) on delete restrict,
  target_record_id uuid not null references public.records(id) on delete restrict,
  relationship_type text not null check (relationship_type in ('located_on','assigned_to','improves','created','replaces','related_to','parent_of','split_from')),
  started_at timestamptz, ended_at timestamptz,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  source public.entry_source not null default 'manual', schema_version integer not null default 1 check (schema_version > 0),
  version integer not null default 1 check (version > 0), client_updated_at timestamptz,
  deleted_at timestamptz, deleted_by uuid references auth.users(id) on delete set null,
  check (source_record_id <> target_record_id),
  check (ended_at is null or started_at is null or ended_at >= started_at)
);

create unique index record_relationships_active_unique_idx
  on public.record_relationships (source_record_id, target_record_id, relationship_type)
  where deleted_at is null and ended_at is null;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  record_id uuid references public.records(id) on delete set null,
  parent_task_id uuid references public.tasks(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 240),
  description text,
  status text not null default 'open' check (status in ('open','in_progress','completed','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  available_from date, due_date date,
  completed_at timestamptz, completed_by uuid references auth.users(id) on delete set null,
  recurrence_rule jsonb check (recurrence_rule is null or jsonb_typeof(recurrence_rule) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  source public.entry_source not null default 'manual', schema_version integer not null default 1 check (schema_version > 0),
  version integer not null default 1 check (version > 0), client_updated_at timestamptz,
  deleted_at timestamptz, deleted_by uuid references auth.users(id) on delete set null,
  check (due_date is null or available_from is null or due_date >= available_from),
  check ((status = 'completed' and completed_at is not null and completed_by is not null)
      or (status <> 'completed'))
);

create unique index tasks_one_next_occurrence_idx on public.tasks (parent_task_id) where parent_task_id is not null;

create table public.task_assignments (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  member_id uuid not null references public.homestead_members(id) on delete restrict,
  assignment_type text not null default 'assignee' check (assignment_type in ('assignee','watcher')),
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  removed_at timestamptz
);

create unique index task_assignments_active_unique_idx
  on public.task_assignments (task_id, member_id) where removed_at is null;

create table public.chronicle_entries (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  record_id uuid references public.records(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  event_type text not null default 'event', occurred_at timestamptz not null default now(),
  summary text, details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  value numeric, unit text,
  corrects_entry_id uuid references public.chronicle_entries(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  source public.entry_source not null default 'manual', schema_version integer not null default 1 check (schema_version > 0),
  version integer not null default 1 check (version > 0), client_updated_at timestamptz,
  deleted_at timestamptz, deleted_by uuid references auth.users(id) on delete set null
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  record_id uuid references public.records(id) on delete set null,
  title text, body text not null check (length(btrim(body)) > 0), pinned boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  source public.entry_source not null default 'manual', schema_version integer not null default 1 check (schema_version > 0),
  version integer not null default 1 check (version > 0), client_updated_at timestamptz,
  deleted_at timestamptz, deleted_by uuid references auth.users(id) on delete set null
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  record_id uuid references public.records(id) on delete set null,
  entry_type text not null check (entry_type in ('income','expense')),
  entry_date date not null default current_date,
  description text not null check (length(btrim(description)) > 0),
  amount numeric(12,2) not null check (amount >= 0), currency_code char(3) not null default 'USD' check (currency_code ~ '^[A-Z]{3}$'),
  category text, vendor_or_source text, receipt_photo_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  source public.entry_source not null default 'manual', schema_version integer not null default 1 check (schema_version > 0),
  version integer not null default 1 check (version > 0), client_updated_at timestamptz,
  deleted_at timestamptz, deleted_by uuid references auth.users(id) on delete set null
);

create table public.audit_entries (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('insert','update','soft_delete','restore','role_change','invitation_accept','export','cellarer_action')),
  table_name text not null, row_id uuid not null,
  changed_fields jsonb not null default '[]'::jsonb,
  before_data jsonb, after_data jsonb,
  source public.entry_source not null default 'system', created_at timestamptz not null default now()
);

create table public.sync_operations (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  idempotency_key text not null check (length(btrim(idempotency_key)) > 0),
  operation_type text not null, table_name text not null, row_id uuid not null,
  request_hash text, status text not null default 'processed' check (status in ('pending','processed','failed')),
  error_code text, created_at timestamptz not null default now(), processed_at timestamptz,
  unique (homestead_id, user_id, idempotency_key)
);

-- Tenant-safe indexes used by policies and the application.
create index records_homestead_active_idx on public.records (homestead_id, type, status) where deleted_at is null;
create index records_homestead_name_idx on public.records (homestead_id, lower(name)) where deleted_at is null;
create index records_updated_idx on public.records (homestead_id, updated_at desc) where deleted_at is null;
create index relationships_homestead_idx on public.record_relationships (homestead_id, source_record_id, target_record_id);
create index tasks_homestead_due_idx on public.tasks (homestead_id, due_date, status) where deleted_at is null;
create index task_assignments_homestead_idx on public.task_assignments (homestead_id, member_id) where removed_at is null;
create index chronicle_homestead_occurred_idx on public.chronicle_entries (homestead_id, occurred_at desc) where deleted_at is null;
create index notes_homestead_updated_idx on public.notes (homestead_id, updated_at desc) where deleted_at is null;
create index ledger_homestead_date_idx on public.ledger_entries (homestead_id, entry_date desc) where deleted_at is null;
create index audit_homestead_created_idx on public.audit_entries (homestead_id, created_at desc);
create index sync_operations_user_idx on public.sync_operations (homestead_id, user_id, created_at desc);

-- Authentication and authorization helpers. They derive tenant identity only
-- from auth.uid(); no client-supplied Homestead identifier is trusted.
create or replace function public.current_homestead_id()
returns uuid language sql stable security definer set search_path = ''
as $$
  select hm.homestead_id from public.homestead_members hm
  where hm.user_id = (select auth.uid()) and hm.status = 'active'
  limit 1
$$;

create or replace function public.current_member_role()
returns public.member_role language sql stable security definer set search_path = ''
as $$
  select hm.role from public.homestead_members hm
  where hm.user_id = (select auth.uid()) and hm.status = 'active'
  limit 1
$$;

create or replace function public.has_capability(capability text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case public.current_member_role()
    when 'steward' then capability = any (array[
      'view_records','create_records','edit_records','archive_records','restore_records',
      'create_tasks','assign_tasks','complete_tasks','record_events','edit_recent_events',
      'add_notes','edit_notes','view_ledger','manage_ledger','upload_photos',
      'manage_members','manage_homestead','export_data','manage_backups','use_cellarer'])
    when 'keeper' then capability = any (array[
      'view_records','create_records','edit_records','archive_records','restore_records',
      'create_tasks','assign_tasks','complete_tasks','record_events','edit_recent_events',
      'add_notes','edit_notes','view_ledger','manage_ledger','export_data','manage_backups'])
    when 'hand' then capability = any (array['view_records','complete_tasks','record_events','add_notes'])
    when 'guest' then capability = 'view_records'
    else false
  end
$$;

create or replace function private.require_user()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  return actor;
end $$;

create or replace function private.touch_row()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if to_jsonb(new) ? 'version' then new.version := old.version + 1; end if;
  return new;
end $$;

create or replace function private.protect_content_fields()
returns trigger language plpgsql set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  -- Trusted migrations and server-side functions do not execute as the Data
  -- API's authenticated role.
  if current_user <> 'authenticated' then return new; end if;
  if actor is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if new.homestead_id is distinct from public.current_homestead_id() then
    raise exception 'Row belongs to another Homestead' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := actor; new.updated_by := actor;
    if new.source = 'cellarer' and not public.has_capability('use_cellarer') then
      raise exception 'Cellarer source is not authorized' using errcode = '42501';
    end if;
  else
    if new.id is distinct from old.id or new.homestead_id is distinct from old.homestead_id
       or new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by
       or new.schema_version is distinct from old.schema_version or new.version is distinct from old.version
       or new.source is distinct from old.source then
      raise exception 'Server-maintained fields cannot be changed' using errcode = '42501';
    end if;
    if (new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by)
       and coalesce(current_setting('regula.allow_deleted_state', true), '') <> 'true' then
      raise exception 'Use the soft-delete or restore function' using errcode = '42501';
    end if;
    new.updated_by := actor;
  end if;
  return new;
end $$;

create or replace function private.protect_task_completion()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated'
     and ((tg_op = 'INSERT' and new.status = 'completed')
       or (tg_op = 'UPDATE' and (new.completed_at is distinct from old.completed_at
         or new.completed_by is distinct from old.completed_by
         or (new.status = 'completed' and old.status <> 'completed'))))
     and coalesce(current_setting('regula.allow_task_completion', true), '') <> 'true' then
    raise exception 'Use complete_recurring_task() to complete a task' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function private.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_json jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  new_json jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  tenant uuid := coalesce((new_json ->> 'homestead_id')::uuid, (old_json ->> 'homestead_id')::uuid);
  event_action text := lower(tg_op);
  changed jsonb := '[]'::jsonb;
begin
  old_json := old_json - 'token_hash'; new_json := new_json - 'token_hash';
  if tg_op = 'UPDATE' then
    if old_json ->> 'deleted_at' is null and new_json ->> 'deleted_at' is not null then event_action := 'soft_delete';
    elsif old_json ->> 'deleted_at' is not null and new_json ->> 'deleted_at' is null then event_action := 'restore';
    elsif tg_table_name = 'homestead_members' and old_json ->> 'role' is distinct from new_json ->> 'role' then event_action := 'role_change';
    else
      select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into changed
      from jsonb_each(new_json) n where old_json -> n.key is distinct from n.value;
    end if;
  end if;
  if coalesce(new_json ->> 'source', old_json ->> 'source') = 'cellarer' then event_action := 'cellarer_action'; end if;
  insert into public.audit_entries (homestead_id, actor_user_id, action, table_name, row_id, changed_fields, before_data, after_data, source)
  values (tenant, (select auth.uid()), event_action, tg_table_name, coalesce(new.id, old.id), changed, old_json, new_json,
    case when coalesce(new_json ->> 'source', old_json ->> 'source') in ('manual','cellarer','migration','import','system')
      then coalesce(new_json ->> 'source', old_json ->> 'source')::public.entry_source else 'system' end);
  return coalesce(new, old);
end $$;

create or replace function private.audit_is_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Audit entries are append-only'; end $$;

create or replace function public.protect_final_steward()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'active' and old.role = 'steward'
     and (tg_op = 'DELETE' or new.status <> 'active' or new.role <> 'steward')
     and not exists (
       select 1 from public.homestead_members hm
       where hm.homestead_id = old.homestead_id and hm.status = 'active'
         and hm.role = 'steward' and hm.id <> old.id
     ) then
    raise exception 'A Homestead must retain at least one active Steward' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function private.validate_same_homestead()
returns trigger language plpgsql set search_path = '' as $$
declare linked_tenant uuid;
begin
  if tg_table_name = 'record_relationships' then
    select r.homestead_id into linked_tenant from public.records r where r.id = new.source_record_id;
    if linked_tenant is distinct from new.homestead_id then raise exception 'Source record belongs to another Homestead'; end if;
    select r.homestead_id into linked_tenant from public.records r where r.id = new.target_record_id;
    if linked_tenant is distinct from new.homestead_id then raise exception 'Target record belongs to another Homestead'; end if;
  elsif tg_table_name = 'task_assignments' then
    select t.homestead_id into linked_tenant from public.tasks t where t.id = new.task_id;
    if linked_tenant is distinct from new.homestead_id then raise exception 'Task belongs to another Homestead'; end if;
    select m.homestead_id into linked_tenant from public.homestead_members m where m.id = new.member_id and m.status = 'active';
    if linked_tenant is distinct from new.homestead_id then raise exception 'Assignee belongs to another Homestead'; end if;
  elsif tg_table_name = 'tasks' then
    if new.record_id is not null then
      select r.homestead_id into linked_tenant from public.records r where r.id = new.record_id;
      if linked_tenant is distinct from new.homestead_id then raise exception 'Record belongs to another Homestead'; end if;
    end if;
    if new.parent_task_id is not null then
      select t.homestead_id into linked_tenant from public.tasks t where t.id = new.parent_task_id;
      if linked_tenant is distinct from new.homestead_id then raise exception 'Parent task belongs to another Homestead'; end if;
    end if;
  elsif tg_table_name = 'chronicle_entries' then
    if new.record_id is not null then
      select r.homestead_id into linked_tenant from public.records r where r.id = new.record_id;
      if linked_tenant is distinct from new.homestead_id then raise exception 'Record belongs to another Homestead'; end if;
    end if;
    if new.task_id is not null then
      select t.homestead_id into linked_tenant from public.tasks t where t.id = new.task_id;
      if linked_tenant is distinct from new.homestead_id then raise exception 'Task belongs to another Homestead'; end if;
    end if;
    if new.corrects_entry_id is not null then
      select c.homestead_id into linked_tenant from public.chronicle_entries c where c.id = new.corrects_entry_id;
      if linked_tenant is distinct from new.homestead_id then raise exception 'Corrected entry belongs to another Homestead'; end if;
    end if;
  elsif tg_table_name in ('notes', 'ledger_entries') and new.record_id is not null then
    select r.homestead_id into linked_tenant from public.records r where r.id = new.record_id;
    if linked_tenant is distinct from new.homestead_id then raise exception 'Record belongs to another Homestead'; end if;
  end if;
  return new;
end $$;

create or replace function public.create_homestead(homestead_name text, homestead_timezone text default 'America/New_York', homestead_currency char(3) default 'USD')
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_user(); new_id uuid;
begin
  if exists (select 1 from public.homestead_members where user_id = actor and status = 'active') then
    raise exception 'User already belongs to an active Homestead' using errcode = '23505';
  end if;
  if length(btrim(homestead_name)) not between 1 and 120 then raise exception 'Homestead name is required'; end if;
  insert into public.homesteads (name, timezone, currency_code, created_by)
    values (btrim(homestead_name), homestead_timezone, upper(homestead_currency), actor) returning id into new_id;
  insert into public.homestead_members (homestead_id, user_id, role, status, joined_at)
    values (new_id, actor, 'steward', 'active', now());
  return new_id;
end $$;

create or replace function public.accept_invitation(invitation_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_user(); actor_email text; invitation public.invitations%rowtype;
begin
  select lower(email) into actor_email from auth.users where id = actor;
  if exists (select 1 from public.homestead_members where user_id = actor and status = 'active') then
    raise exception 'User already belongs to an active Homestead' using errcode = '23505';
  end if;
  select * into invitation from public.invitations
    where token_hash = encode(extensions.digest(invitation_token, 'sha256'), 'hex') for update;
  if not found or invitation.accepted_at is not null or invitation.revoked_at is not null
     or invitation.expires_at <= now() or invitation.email_normalized <> actor_email then
    raise exception 'Invitation is invalid or expired' using errcode = '22023';
  end if;
  insert into public.homestead_members (homestead_id, user_id, role, status, joined_at, invited_by)
    values (invitation.homestead_id, actor, invitation.role, 'active', now(), invitation.invited_by);
  update public.invitations set accepted_at = now(), accepted_by = actor where id = invitation.id;
  insert into public.audit_entries (homestead_id, actor_user_id, action, table_name, row_id, after_data)
    values (invitation.homestead_id, actor, 'invitation_accept', 'invitations', invitation.id,
      jsonb_build_object('accepted_by', actor, 'role', invitation.role));
  return invitation.homestead_id;
end $$;

create or replace function public.complete_recurring_task(task_to_complete uuid, operation_key text, client_device_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_user(); tenant uuid := public.current_homestead_id(); current_task public.tasks%rowtype; next_id uuid; base_date date; next_due date; every_n integer;
begin
  if tenant is null or not public.has_capability('complete_tasks') then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into current_task from public.tasks where id = task_to_complete and homestead_id = tenant and deleted_at is null for update;
  if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
  if public.current_member_role() = 'hand' and not exists (
    select 1 from public.task_assignments a join public.homestead_members m on m.id = a.member_id
    where a.task_id = current_task.id and a.removed_at is null and m.user_id = actor and m.status = 'active'
  ) then raise exception 'Task is not assigned to this member' using errcode = '42501'; end if;
  select t.id into next_id from public.sync_operations s left join public.tasks t on t.parent_task_id = s.row_id
    where s.homestead_id = tenant and s.user_id = actor and s.idempotency_key = operation_key;
  if found then return next_id; end if;
  perform set_config('regula.allow_task_completion', 'true', true);
  update public.tasks set status = 'completed', completed_at = now(), completed_by = actor, updated_by = actor where id = current_task.id;
  if current_task.recurrence_rule is not null then
    every_n := greatest(coalesce((current_task.recurrence_rule ->> 'interval')::integer, 1), 1);
    base_date := case when current_task.recurrence_rule ->> 'mode' = 'after_completion' then current_date else coalesce(current_task.due_date, current_date) end;
    next_due := case current_task.recurrence_rule ->> 'frequency'
      when 'daily' then base_date + every_n
      when 'weekly' then base_date + (7 * every_n)
      when 'monthly' then (base_date + make_interval(months => every_n))::date
      else null end;
    if next_due is null then raise exception 'Unsupported recurrence frequency'; end if;
    insert into public.tasks (homestead_id, record_id, parent_task_id, title, description, status, priority, available_from, due_date, recurrence_rule, created_by, updated_by, source)
      values (tenant, current_task.record_id, current_task.id, current_task.title, current_task.description, 'open', current_task.priority, null, next_due, current_task.recurrence_rule, actor, actor, 'system')
      returning id into next_id;
  end if;
  insert into public.sync_operations (homestead_id, user_id, device_id, idempotency_key, operation_type, table_name, row_id, request_hash, status, processed_at)
    values (tenant, actor, client_device_id, operation_key, 'complete_task', 'tasks', current_task.id,
      encode(extensions.digest(current_task.id::text || ':' || operation_key, 'sha256'), 'hex'), 'processed', now());
  return next_id;
exception when unique_violation then
  select t.id into next_id from public.sync_operations s left join public.tasks t on t.parent_task_id = s.row_id
    where s.homestead_id = tenant and s.user_id = actor and s.idempotency_key = operation_key;
  return next_id;
end $$;

create or replace function private.change_deleted_state(target_table text, target_id uuid, restore boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_user(); tenant uuid := public.current_homestead_id(); required_capability text;
begin
  if target_table not in ('records','record_relationships','tasks','chronicle_entries','notes','ledger_entries') then
    raise exception 'Unsupported table' using errcode = '22023';
  end if;
  required_capability := case
    when target_table in ('records','record_relationships') and restore then 'restore_records'
    when target_table in ('records','record_relationships') then 'archive_records'
    when target_table = 'ledger_entries' then 'manage_ledger'
    when target_table = 'notes' then 'edit_notes'
    when target_table = 'chronicle_entries' then 'edit_recent_events'
    else 'create_tasks' end;
  if tenant is null or not public.has_capability(required_capability) then raise exception 'Not authorized' using errcode = '42501'; end if;
  perform set_config('regula.allow_deleted_state', 'true', true);
  execute format('update public.%I set deleted_at = $1, deleted_by = $2, updated_by = $2 where id = $3 and homestead_id = $4', target_table)
    using case when restore then null else now() end, case when restore then null else actor end, target_id, tenant;
  if not found then raise exception 'Row not found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.soft_delete_row(target_table text, target_id uuid)
returns void language sql security definer set search_path = '' as $$ select private.change_deleted_state(target_table, target_id, false) $$;
create or replace function public.restore_row(target_table text, target_id uuid)
returns void language sql security definer set search_path = '' as $$ select private.change_deleted_state(target_table, target_id, true) $$;

-- Automatic profile creation uses Auth's trusted user identifier. Metadata is
-- display-only and never participates in authorization.
create or replace function private.create_profile_for_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), 'Member'));
  return new;
end $$;

create trigger auth_user_profile after insert on auth.users for each row execute function private.create_profile_for_user();
create trigger protect_last_steward before update or delete on public.homestead_members for each row execute function public.protect_final_steward();
create trigger immutable_audit before update or delete on public.audit_entries for each row execute function private.audit_is_immutable();
create trigger validate_relationship_homestead before insert or update on public.record_relationships for each row execute function private.validate_same_homestead();
create trigger validate_assignment_homestead before insert or update on public.task_assignments for each row execute function private.validate_same_homestead();
create trigger validate_task_homestead before insert or update on public.tasks for each row execute function private.validate_same_homestead();
create trigger validate_chronicle_homestead before insert or update on public.chronicle_entries for each row execute function private.validate_same_homestead();
create trigger validate_note_homestead before insert or update on public.notes for each row execute function private.validate_same_homestead();
create trigger validate_ledger_homestead before insert or update on public.ledger_entries for each row execute function private.validate_same_homestead();
create trigger protect_task_completion before insert or update on public.tasks for each row execute function private.protect_task_completion();

do $$ declare table_name text; begin
  foreach table_name in array array['homesteads','profiles','homestead_members','records','record_relationships','tasks','chronicle_entries','notes','ledger_entries']
  loop execute format('create trigger touch_%I before update on public.%I for each row execute function private.touch_row()', table_name, table_name); end loop;
  foreach table_name in array array['homestead_members','records','record_relationships','tasks','task_assignments','chronicle_entries','notes','ledger_entries']
  loop execute format('create trigger audit_%I after insert or update on public.%I for each row execute function private.audit_row()', table_name, table_name); end loop;
  foreach table_name in array array['records','record_relationships','tasks','chronicle_entries','notes','ledger_entries']
  loop execute format('create trigger protect_content_%I before insert or update on public.%I for each row execute function private.protect_content_fields()', table_name, table_name); end loop;
end $$;

-- Every application table is deny-all until an explicit policy grants access.
alter table public.homesteads enable row level security;
alter table public.profiles enable row level security;
alter table public.homestead_members enable row level security;
alter table public.invitations enable row level security;
alter table public.records enable row level security;
alter table public.record_relationships enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignments enable row level security;
alter table public.chronicle_entries enable row level security;
alter table public.notes enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.audit_entries enable row level security;
alter table public.sync_operations enable row level security;

create policy homesteads_select on public.homesteads for select to authenticated using (id = public.current_homestead_id());
create policy homesteads_update on public.homesteads for update to authenticated using (id = public.current_homestead_id() and public.has_capability('manage_homestead')) with check (id = public.current_homestead_id() and public.has_capability('manage_homestead'));

create policy profiles_select on public.profiles for select to authenticated using (
  id = (select auth.uid()) or exists (
    select 1 from public.homestead_members self_member join public.homestead_members peer on peer.homestead_id = self_member.homestead_id
    where self_member.user_id = (select auth.uid()) and self_member.status = 'active' and peer.user_id = profiles.id and peer.status = 'active'));
create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy members_select on public.homestead_members for select to authenticated using (homestead_id = public.current_homestead_id());
create policy members_insert on public.homestead_members for insert to authenticated with check (homestead_id = public.current_homestead_id() and public.has_capability('manage_members'));
create policy members_update on public.homestead_members for update to authenticated using (homestead_id = public.current_homestead_id() and public.has_capability('manage_members')) with check (homestead_id = public.current_homestead_id() and public.has_capability('manage_members'));

create policy invitations_select on public.invitations for select to authenticated using (homestead_id = public.current_homestead_id() and public.has_capability('manage_members'));
create policy invitations_insert on public.invitations for insert to authenticated with check (homestead_id = public.current_homestead_id() and invited_by = (select auth.uid()) and public.has_capability('manage_members'));
create policy invitations_update on public.invitations for update to authenticated using (homestead_id = public.current_homestead_id() and public.has_capability('manage_members')) with check (homestead_id = public.current_homestead_id() and public.has_capability('manage_members'));

create policy records_select on public.records for select to authenticated using (homestead_id = public.current_homestead_id() and public.has_capability('view_records'));
create policy records_insert on public.records for insert to authenticated with check (homestead_id = public.current_homestead_id() and created_by = (select auth.uid()) and public.has_capability('create_records'));
create policy records_update on public.records for update to authenticated using (homestead_id = public.current_homestead_id() and public.has_capability('edit_records')) with check (homestead_id = public.current_homestead_id() and public.has_capability('edit_records'));

create policy relationships_select on public.record_relationships for select to authenticated using (homestead_id = public.current_homestead_id() and public.has_capability('view_records'));
create policy relationships_insert on public.record_relationships for insert to authenticated with check (homestead_id = public.current_homestead_id() and created_by = (select auth.uid()) and public.has_capability('edit_records'));
create policy relationships_update on public.record_relationships for update to authenticated using (homestead_id = public.current_homestead_id() and public.has_capability('edit_records')) with check (homestead_id = public.current_homestead_id() and public.has_capability('edit_records'));

create policy tasks_select on public.tasks for select to authenticated using (
  homestead_id = public.current_homestead_id() and (public.current_member_role() <> 'hand' or exists (
    select 1 from public.task_assignments a join public.homestead_members m on m.id = a.member_id
    where a.task_id = tasks.id and a.removed_at is null and m.user_id = (select auth.uid()) and m.status = 'active')));
create policy tasks_insert on public.tasks for insert to authenticated with check (homestead_id = public.current_homestead_id() and created_by = (select auth.uid()) and public.has_capability('create_tasks'));
create policy tasks_update on public.tasks for update to authenticated using (homestead_id = public.current_homestead_id() and public.current_member_role() in ('steward','keeper')) with check (homestead_id = public.current_homestead_id() and public.current_member_role() in ('steward','keeper'));

create policy assignments_select on public.task_assignments for select to authenticated using (homestead_id = public.current_homestead_id() and (public.current_member_role() <> 'hand' or exists (select 1 from public.homestead_members m where m.id = member_id and m.user_id = (select auth.uid()))));
create policy assignments_insert on public.task_assignments for insert to authenticated with check (homestead_id = public.current_homestead_id() and assigned_by = (select auth.uid()) and public.has_capability('assign_tasks'));
create policy assignments_update on public.task_assignments for update to authenticated using (homestead_id = public.current_homestead_id() and public.has_capability('assign_tasks')) with check (homestead_id = public.current_homestead_id() and public.has_capability('assign_tasks'));

create policy chronicle_select on public.chronicle_entries for select to authenticated using (homestead_id = public.current_homestead_id() and public.has_capability('view_records'));
create policy chronicle_insert on public.chronicle_entries for insert to authenticated with check (homestead_id = public.current_homestead_id() and created_by = (select auth.uid()) and public.has_capability('record_events'));
create policy chronicle_update on public.chronicle_entries for update to authenticated using (homestead_id = public.current_homestead_id() and public.has_capability('edit_recent_events')) with check (homestead_id = public.current_homestead_id() and public.has_capability('edit_recent_events'));

create policy notes_select on public.notes for select to authenticated using (homestead_id = public.current_homestead_id() and public.has_capability('view_records'));
create policy notes_insert on public.notes for insert to authenticated with check (homestead_id = public.current_homestead_id() and created_by = (select auth.uid()) and public.has_capability('add_notes'));
create policy notes_update on public.notes for update to authenticated using (homestead_id = public.current_homestead_id() and public.has_capability('edit_notes')) with check (homestead_id = public.current_homestead_id() and public.has_capability('edit_notes'));

create policy ledger_select on public.ledger_entries for select to authenticated using (homestead_id = public.current_homestead_id() and public.has_capability('view_ledger'));
create policy ledger_insert on public.ledger_entries for insert to authenticated with check (homestead_id = public.current_homestead_id() and created_by = (select auth.uid()) and public.has_capability('manage_ledger'));
create policy ledger_update on public.ledger_entries for update to authenticated using (homestead_id = public.current_homestead_id() and public.has_capability('manage_ledger')) with check (homestead_id = public.current_homestead_id() and public.has_capability('manage_ledger'));

create policy audit_select on public.audit_entries for select to authenticated using (homestead_id = public.current_homestead_id() and public.current_member_role() = 'steward');
create policy sync_select on public.sync_operations for select to authenticated using (homestead_id = public.current_homestead_id() and user_id = (select auth.uid()));

-- Current Supabase projects do not auto-expose new Data API objects. Keep
-- privileges explicit and minimal; mutations are further constrained by RLS.
revoke all on all tables in schema public from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.homesteads, public.profiles, public.homestead_members, public.invitations,
  public.records, public.record_relationships, public.tasks, public.task_assignments,
  public.chronicle_entries, public.notes, public.ledger_entries, public.audit_entries,
  public.sync_operations to authenticated;
grant insert, update on public.profiles, public.homestead_members, public.invitations,
  public.records, public.record_relationships, public.tasks, public.task_assignments,
  public.chronicle_entries, public.notes, public.ledger_entries to authenticated;
grant update (name, slug, timezone, currency_code) on public.homesteads to authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function public.current_homestead_id() to authenticated;
grant execute on function public.current_member_role() to authenticated;
grant execute on function public.has_capability(text) to authenticated;
grant execute on function public.create_homestead(text, text, char) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.complete_recurring_task(uuid, text, uuid) to authenticated;
grant execute on function public.soft_delete_row(text, uuid) to authenticated;
grant execute on function public.restore_row(text, uuid) to authenticated;
