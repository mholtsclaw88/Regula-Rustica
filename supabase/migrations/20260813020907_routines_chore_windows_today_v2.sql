-- Routines, Chore Windows, and Today v2.
-- Routines are durable definitions; occurrences are the dated, completable work.

create table public.chore_windows (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  system_key text check (system_key in ('morning','evening') or system_key is null),
  name text not null check (length(btrim(name)) between 1 and 80),
  display_order integer not null default 0, enabled boolean not null default true,
  daypart text check (daypart in ('morning','evening','other') or daypart is null),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  source public.entry_source not null default 'manual', schema_version integer not null default 1 check (schema_version > 0),
  version integer not null default 1 check (version > 0), client_updated_at timestamptz,
  deleted_at timestamptz, deleted_by uuid references auth.users(id) on delete set null
);
create unique index chore_windows_system_unique on public.chore_windows (homestead_id, system_key) where system_key is not null and deleted_at is null;
create index chore_windows_sync_cursor_idx on public.chore_windows (homestead_id, updated_at, id);

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  record_id uuid not null references public.records(id) on delete restrict,
  chore_window_id uuid references public.chore_windows(id) on delete set null,
  person_id uuid references public.homestead_people(id) on delete set null,
  name text not null check (length(btrim(name)) between 1 and 120),
  routine_type text check (routine_type in ('milk_morning','milk_evening','egg_collection') or routine_type is null),
  enabled boolean not null default true,
  frequency text not null default 'daily' check (frequency in ('daily','weekly','monthly')),
  interval integer not null default 1 check (interval between 1 and 365),
  first_date date not null, next_date date not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  source public.entry_source not null default 'manual', schema_version integer not null default 1 check (schema_version > 0),
  version integer not null default 1 check (version > 0), client_updated_at timestamptz,
  deleted_at timestamptz, deleted_by uuid references auth.users(id) on delete set null
);
create unique index routines_structured_unique on public.routines (homestead_id, record_id, routine_type) where routine_type is not null and deleted_at is null;
create index routines_record_idx on public.routines (homestead_id, record_id) where deleted_at is null;
create index routines_sync_cursor_idx on public.routines (homestead_id, updated_at, id);

create table public.routine_occurrences (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  routine_id uuid not null references public.routines(id) on delete restrict,
  occurrence_date date not null,
  status text not null default 'pending' check (status in ('pending','completed','skipped')),
  completion_method text check (completion_method in ('ordinary','yield','without_yield','migration') or completion_method is null),
  completed_at timestamptz, completed_by uuid references auth.users(id) on delete set null,
  legacy_task_id uuid references public.tasks(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null, updated_by uuid references auth.users(id) on delete set null,
  source public.entry_source not null default 'manual', schema_version integer not null default 1 check (schema_version > 0),
  version integer not null default 1 check (version > 0), client_updated_at timestamptz,
  deleted_at timestamptz, deleted_by uuid references auth.users(id) on delete set null,
  check ((status = 'pending' and completed_at is null and completed_by is null and completion_method is null)
    or (status <> 'pending' and completed_at is not null and completion_method is not null))
);
create unique index routine_occurrences_date_unique on public.routine_occurrences (routine_id, occurrence_date) where deleted_at is null;
create unique index routine_occurrences_legacy_task_unique on public.routine_occurrences (legacy_task_id) where legacy_task_id is not null;
create index routine_occurrences_due_idx on public.routine_occurrences (homestead_id, occurrence_date, status) where deleted_at is null;
create index routine_occurrences_sync_cursor_idx on public.routine_occurrences (homestead_id, updated_at, id);

create or replace function private.validate_routine_homestead()
returns trigger language plpgsql set search_path = '' as $$
declare record_tenant uuid; record_type text; record_identity jsonb; window_tenant uuid; person_tenant uuid; routine_tenant uuid;
begin
  if tg_table_name = 'routines' then
    select homestead_id,type,identity into record_tenant,record_type,record_identity from public.records where id = new.record_id and deleted_at is null;
    if record_tenant is distinct from new.homestead_id then raise exception 'Record belongs to another Homestead' using errcode = '23503'; end if;
    if new.routine_type is not null and (record_type <> 'animal'
      or (new.routine_type in ('milk_morning','milk_evening') and lower(coalesce(record_identity->>'purpose','')) <> 'dairy')
      or (new.routine_type = 'egg_collection' and lower(coalesce(record_identity->>'purpose','')) <> 'eggs')) then
      raise exception 'Routine type does not match the Animal purpose' using errcode = '23514';
    end if;
    if new.chore_window_id is not null then select homestead_id into window_tenant from public.chore_windows where id = new.chore_window_id and deleted_at is null; end if;
    if new.chore_window_id is not null and window_tenant is distinct from new.homestead_id then raise exception 'Chore Window belongs to another Homestead' using errcode = '23503'; end if;
    if new.person_id is not null then select homestead_id into person_tenant from public.homestead_people where id = new.person_id and deleted_at is null; end if;
    if new.person_id is not null and person_tenant is distinct from new.homestead_id then raise exception 'Assignee belongs to another Homestead' using errcode = '23503'; end if;
  elsif tg_table_name = 'routine_occurrences' then
    select homestead_id into routine_tenant from public.routines where id = new.routine_id and deleted_at is null;
    if routine_tenant is distinct from new.homestead_id then raise exception 'Routine belongs to another Homestead' using errcode = '23503'; end if;
  end if;
  return new;
end $$;

create or replace function private.protect_routine_completion()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and (new.routine_id is distinct from old.routine_id
    or new.occurrence_date is distinct from old.occurrence_date or new.legacy_task_id is distinct from old.legacy_task_id) then
    raise exception 'Routine occurrence identity cannot be changed' using errcode = '42501';
  end if;
  if current_user = 'authenticated' and tg_op = 'UPDATE'
    and (new.status is distinct from old.status or new.completed_at is distinct from old.completed_at or new.completed_by is distinct from old.completed_by or new.completion_method is distinct from old.completion_method)
    and coalesce(current_setting('regula.allow_routine_completion', true), '') <> 'true' then
    raise exception 'Use apply_routine_sync_operation() to complete a Routine occurrence' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function private.advance_routine_occurrence()
returns trigger language plpgsql security definer set search_path = '' as $$
declare linked public.routines%rowtype; next_day date;
begin
  if old.status <> 'pending' or new.status = 'pending' then return new; end if;
  select * into linked from public.routines where id = new.routine_id and deleted_at is null for update;
  if not found or not linked.enabled then return new; end if;
  next_day := case linked.frequency
    when 'daily' then new.occurrence_date + linked.interval
    when 'weekly' then new.occurrence_date + (7 * linked.interval)
    when 'monthly' then (new.occurrence_date + make_interval(months => linked.interval))::date end;
  insert into public.routine_occurrences (homestead_id, routine_id, occurrence_date, created_by, updated_by, source)
    values (linked.homestead_id, linked.id, next_day, new.completed_by, new.completed_by, 'system') on conflict do nothing;
  update public.routines set next_date = next_day, updated_by = new.completed_by where id = linked.id and next_date < next_day;
  return new;
end $$;

create trigger validate_routines_homestead before insert or update on public.routines for each row execute function private.validate_routine_homestead();
create trigger validate_occurrences_homestead before insert or update on public.routine_occurrences for each row execute function private.validate_routine_homestead();
create trigger protect_occurrence_completion before update on public.routine_occurrences for each row execute function private.protect_routine_completion();
create trigger touch_chore_windows before update on public.chore_windows for each row execute function private.touch_row();
create trigger touch_routines before update on public.routines for each row execute function private.touch_row();
create trigger touch_routine_occurrences before update on public.routine_occurrences for each row execute function private.touch_row();
create trigger protect_content_chore_windows before insert or update on public.chore_windows for each row execute function private.protect_content_fields();
create trigger protect_content_routines before insert or update on public.routines for each row execute function private.protect_content_fields();
create trigger protect_content_routine_occurrences before insert or update on public.routine_occurrences for each row execute function private.protect_content_fields();
create trigger audit_chore_windows after insert or update on public.chore_windows for each row execute function private.audit_row();
create trigger audit_routines after insert or update on public.routines for each row execute function private.audit_row();
create trigger audit_routine_occurrences after insert or update on public.routine_occurrences for each row execute function private.audit_row();
create trigger advance_routine_occurrence after update on public.routine_occurrences for each row execute function private.advance_routine_occurrence();

create or replace function public.can_complete_routine(target_routine uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_capability('complete_tasks') and (
    public.current_member_role() <> 'hand' or exists (
      select 1 from public.routines r join public.homestead_people p on p.id = r.person_id
      join public.homestead_members m on m.id = p.member_id
      where r.id = target_routine and r.homestead_id = public.current_homestead_id()
        and m.user_id = (select auth.uid()) and m.status = 'active'))
$$;

alter table public.chore_windows enable row level security;
alter table public.routines enable row level security;
alter table public.routine_occurrences enable row level security;
create policy chore_windows_select on public.chore_windows for select to authenticated using (homestead_id = public.current_homestead_id() and public.has_capability('view_records'));
create policy chore_windows_insert on public.chore_windows for insert to authenticated with check (homestead_id = public.current_homestead_id() and public.has_capability('create_tasks'));
create policy chore_windows_update on public.chore_windows for update to authenticated using (homestead_id = public.current_homestead_id() and public.has_capability('create_tasks')) with check (homestead_id = public.current_homestead_id() and public.has_capability('create_tasks'));
create policy routines_select on public.routines for select to authenticated using (homestead_id = public.current_homestead_id() and public.has_capability('view_records'));
create policy routines_insert on public.routines for insert to authenticated with check (homestead_id = public.current_homestead_id() and public.has_capability('create_tasks'));
create policy routines_update on public.routines for update to authenticated using (homestead_id = public.current_homestead_id() and public.has_capability('create_tasks')) with check (homestead_id = public.current_homestead_id() and public.has_capability('create_tasks'));
create policy occurrences_select on public.routine_occurrences for select to authenticated using (homestead_id = public.current_homestead_id() and public.has_capability('view_records'));
create policy occurrences_insert on public.routine_occurrences for insert to authenticated with check (homestead_id = public.current_homestead_id() and public.has_capability('create_tasks'));
create policy occurrences_update on public.routine_occurrences for update to authenticated using (homestead_id = public.current_homestead_id() and public.can_complete_routine(routine_id)) with check (homestead_id = public.current_homestead_id() and public.can_complete_routine(routine_id));

revoke all on public.chore_windows, public.routines, public.routine_occurrences from public, anon, authenticated;
grant select, insert, update on public.chore_windows, public.routines, public.routine_occurrences to authenticated;

create or replace function private.create_default_chore_windows()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.chore_windows(homestead_id,system_key,name,display_order,daypart,source)
  values(new.id,'morning','Morning',10,'morning','system'),(new.id,'evening','Evening',20,'evening','system');
  return new;
end $$;
create trigger create_default_chore_windows after insert on public.homesteads for each row execute function private.create_default_chore_windows();

-- Every existing Homestead receives the two conservative defaults.
insert into public.chore_windows (homestead_id, system_key, name, display_order, daypart, source)
select id, 'morning', 'Morning', 10, 'morning', 'system'::public.entry_source from public.homesteads
union all select id, 'evening', 'Evening', 20, 'evening', 'system'::public.entry_source from public.homesteads;

-- Migrate only explicitly structured Task-backed Routines. The Task ID becomes
-- the stable Routine ID; all Task rows remain as hidden historical anchors.
with candidates as (
  select t.*, row_number() over (partition by t.homestead_id, t.record_id, t.recurrence_rule ->> 'routineType'
    order by case when t.status in ('open','in_progress') and t.deleted_at is null then 0 else 1 end, coalesce(t.due_date,t.available_from) desc, t.created_at desc) as choice
  from public.tasks t where t.recurrence_rule ->> 'routineType' in ('milk_morning','milk_evening','egg_collection')
)
insert into public.routines (id, homestead_id, record_id, chore_window_id, person_id, name, routine_type, enabled, frequency, interval, first_date, next_date, created_at, updated_at, created_by, updated_by, source)
select c.id, c.homestead_id, c.record_id, w.id,
  (select a.person_id from public.task_assignments a where a.task_id = c.id and a.removed_at is null order by a.assigned_at limit 1),
  case c.recurrence_rule ->> 'routineType' when 'milk_morning' then 'Morning Milking' when 'milk_evening' then 'Evening Milking' else 'Egg Collection' end,
  c.recurrence_rule ->> 'routineType', c.deleted_at is null,
  coalesce(c.recurrence_rule ->> 'frequency','daily'), greatest(coalesce((c.recurrence_rule ->> 'interval')::integer,1),1),
  coalesce(c.due_date,c.available_from,current_date), coalesce(c.due_date,c.available_from,current_date), c.created_at, c.updated_at, c.created_by, c.updated_by, 'migration'::public.entry_source
from candidates c join public.chore_windows w on w.homestead_id = c.homestead_id
 and w.system_key = case when c.recurrence_rule ->> 'routineType' = 'milk_evening' then 'evening' else 'morning' end
where c.choice = 1 on conflict do nothing;

insert into public.routine_occurrences (id, homestead_id, routine_id, occurrence_date, status, completion_method, completed_at, completed_by, legacy_task_id, created_at, updated_at, created_by, updated_by, source)
select t.id, t.homestead_id, r.id, coalesce(t.due_date,t.available_from,t.created_at::date),
  case when t.status = 'completed' then 'completed' when t.status = 'cancelled' then 'skipped' else 'pending' end,
  case when t.status = 'completed' then 'migration' when t.status = 'cancelled' then 'migration' else null end,
  case when t.status in ('completed','cancelled') then coalesce(t.completed_at,t.updated_at) else null end,
  case when t.status in ('completed','cancelled') then coalesce(t.completed_by,t.updated_by,t.created_by) else null end, t.id, t.created_at, t.updated_at, t.created_by, t.updated_by, 'migration'::public.entry_source
from public.tasks t join public.routines r on r.homestead_id = t.homestead_id and r.record_id = t.record_id
 and r.routine_type = t.recurrence_rule ->> 'routineType'
where t.recurrence_rule ->> 'routineType' in ('milk_morning','milk_evening','egg_collection') on conflict do nothing;

update public.tasks t set recurrence_rule = jsonb_set(t.recurrence_rule, '{migratedToRoutineId}', to_jsonb(o.routine_id::text), true)
from public.routine_occurrences o where o.legacy_task_id = t.id;

alter table public.yield_entries add column routine_occurrence_id uuid references public.routine_occurrences(id) on delete restrict;
create unique index yield_entries_one_per_routine_occurrence on public.yield_entries (routine_occurrence_id) where routine_occurrence_id is not null;
update public.yield_entries y set routine_occurrence_id = o.id from public.routine_occurrences o where o.legacy_task_id = y.task_id;

create or replace function private.next_routine_date(base_date date, frequency text, every_n integer)
returns date language sql immutable set search_path = '' as $$
  select case frequency when 'daily' then base_date + greatest(every_n,1)
    when 'weekly' then base_date + (7 * greatest(every_n,1))
    when 'monthly' then (base_date + make_interval(months => greatest(every_n,1)))::date end
$$;

create or replace function public.apply_routine_sync_operation(operation_key text, client_device_id uuid, target_table text, target_id uuid, operation_kind text, expected_version integer, client_timestamp timestamptz, operation_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_user(); tenant uuid := public.current_homestead_id(); request_digest text; prior public.sync_operations%rowtype; current_row jsonb; result jsonb; linked_routine uuid;
begin
  if tenant is null or target_table not in ('chore_windows','routines','routine_occurrences') or operation_kind not in ('create','update','soft_delete','restore') then raise exception 'Unsupported Routine sync operation' using errcode = '22023'; end if;
  if operation_key is null or client_device_id is null or target_id is null then raise exception 'Sync identity is required' using errcode = '22023'; end if;
  operation_payload := coalesce(operation_payload, '{}'::jsonb);
  if target_table = 'routine_occurrences' then
    linked_routine := coalesce((operation_payload ->> 'routine_id')::uuid, (select routine_id from public.routine_occurrences where id = target_id and homestead_id = tenant));
    if operation_kind = 'create' and not public.has_capability('create_tasks') then raise exception 'Not authorized' using errcode = '42501'; end if;
    if operation_kind <> 'create' and not public.can_complete_routine(linked_routine) then raise exception 'Not authorized' using errcode = '42501'; end if;
  elsif not public.has_capability('create_tasks') then raise exception 'Not authorized' using errcode = '42501'; end if;
  request_digest := encode(extensions.digest(concat_ws(':', client_device_id,target_table,target_id,operation_kind,coalesce(expected_version::text,''),coalesce(client_timestamp::text,''),operation_payload::text),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(concat_ws(':',tenant,actor,operation_key),0));
  select * into prior from public.sync_operations where homestead_id=tenant and user_id=actor and idempotency_key=operation_key for update;
  if found then if prior.request_hash is distinct from request_digest then raise exception 'Idempotency key was reused for a different request' using errcode='22023'; end if; return prior.response; end if;
  if operation_kind = 'create' then
    if target_table = 'chore_windows' then
      insert into public.chore_windows(id,homestead_id,system_key,name,display_order,enabled,daypart,created_by,updated_by,client_updated_at)
      values(target_id,tenant,operation_payload->>'system_key',operation_payload->>'name',coalesce((operation_payload->>'display_order')::integer,0),coalesce((operation_payload->>'enabled')::boolean,true),operation_payload->>'daypart',actor,actor,client_timestamp) on conflict(id) do nothing returning to_jsonb(chore_windows.*) into current_row;
    elsif target_table = 'routines' then
      insert into public.routines(id,homestead_id,record_id,chore_window_id,person_id,name,routine_type,enabled,frequency,interval,first_date,next_date,created_by,updated_by,client_updated_at)
      values(target_id,tenant,(operation_payload->>'record_id')::uuid,(operation_payload->>'chore_window_id')::uuid,(operation_payload->>'person_id')::uuid,operation_payload->>'name',operation_payload->>'routine_type',coalesce((operation_payload->>'enabled')::boolean,true),operation_payload->>'frequency',coalesce((operation_payload->>'interval')::integer,1),(operation_payload->>'first_date')::date,(operation_payload->>'next_date')::date,actor,actor,client_timestamp) on conflict(id) do nothing returning to_jsonb(routines.*) into current_row;
    else
      insert into public.routine_occurrences(id,homestead_id,routine_id,occurrence_date,status,completion_method,completed_at,completed_by,legacy_task_id,created_by,updated_by,client_updated_at)
      values(target_id,tenant,(operation_payload->>'routine_id')::uuid,(operation_payload->>'occurrence_date')::date,coalesce(operation_payload->>'status','pending'),operation_payload->>'completion_method',(operation_payload->>'completed_at')::timestamptz,case when operation_payload->>'status' in ('completed','skipped') then actor end,(operation_payload->>'legacy_task_id')::uuid,actor,actor,client_timestamp) on conflict(id) do nothing returning to_jsonb(routine_occurrences.*) into current_row;
    end if;
  else
    if expected_version is null then raise exception 'Expected version is required' using errcode='22023'; end if;
    if operation_kind in ('soft_delete','restore') then perform set_config('regula.allow_deleted_state','true',true); execute format('update public.%I t set deleted_at=$1,deleted_by=$2,updated_by=$2,client_updated_at=$3 where id=$4 and homestead_id=$5 and version=$6 returning to_jsonb(t.*)',target_table) into current_row using case when operation_kind='restore' then null else now() end,case when operation_kind='restore' then null else actor end,client_timestamp,target_id,tenant,expected_version;
    elsif target_table = 'chore_windows' then update public.chore_windows set system_key=operation_payload->>'system_key',name=operation_payload->>'name',display_order=coalesce((operation_payload->>'display_order')::integer,0),enabled=coalesce((operation_payload->>'enabled')::boolean,true),daypart=operation_payload->>'daypart',updated_by=actor,client_updated_at=client_timestamp where id=target_id and homestead_id=tenant and version=expected_version returning to_jsonb(chore_windows.*) into current_row;
    elsif target_table = 'routines' then update public.routines set record_id=(operation_payload->>'record_id')::uuid,chore_window_id=(operation_payload->>'chore_window_id')::uuid,person_id=(operation_payload->>'person_id')::uuid,name=operation_payload->>'name',routine_type=operation_payload->>'routine_type',enabled=coalesce((operation_payload->>'enabled')::boolean,true),frequency=operation_payload->>'frequency',interval=coalesce((operation_payload->>'interval')::integer,1),first_date=(operation_payload->>'first_date')::date,next_date=(operation_payload->>'next_date')::date,updated_by=actor,client_updated_at=client_timestamp where id=target_id and homestead_id=tenant and version=expected_version returning to_jsonb(routines.*) into current_row;
    else perform set_config('regula.allow_routine_completion','true',true); update public.routine_occurrences set status=operation_payload->>'status',completion_method=operation_payload->>'completion_method',completed_at=(operation_payload->>'completed_at')::timestamptz,completed_by=case when operation_payload->>'status' in ('completed','skipped') then actor end,updated_by=actor,client_updated_at=client_timestamp where id=target_id and homestead_id=tenant and version=expected_version returning to_jsonb(routine_occurrences.*) into current_row;
    end if;
  end if;
  if current_row is null then execute format('select to_jsonb(t.*) from public.%I t where t.id=$1 and t.homestead_id=$2',target_table) into current_row using target_id,tenant; result:=jsonb_build_object('status','conflict','row',current_row); else result:=jsonb_build_object('status','applied','row',current_row); end if;
  insert into public.sync_operations(homestead_id,user_id,device_id,idempotency_key,operation_type,table_name,row_id,request_hash,status,response,processed_at) values(tenant,actor,client_device_id,operation_key,operation_kind,target_table,target_id,request_digest,'processed',result,now());
  return result;
end $$;

-- Promote the occurrence reference transported in details by the existing Yield RPC.
create or replace function private.promote_yield_routine_occurrence()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.routine_occurrence_id is null and new.details ? 'routine_occurrence_id' and nullif(new.details->>'routine_occurrence_id','') is not null then new.routine_occurrence_id := (new.details->>'routine_occurrence_id')::uuid; end if;
  new.details := new.details - 'routine_occurrence_id';
  return new;
end $$;
create trigger promote_yield_routine_occurrence before insert or update on public.yield_entries for each row execute function private.promote_yield_routine_occurrence();

create or replace function private.complete_routine_from_yield()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_user(); occurrence public.routine_occurrences%rowtype; routine public.routines%rowtype; homestead_timezone text; yield_date date;
begin
  if new.routine_occurrence_id is null then return new; end if;
  select * into occurrence from public.routine_occurrences where id=new.routine_occurrence_id and homestead_id=new.homestead_id and deleted_at is null for update;
  select * into routine from public.routines where id=occurrence.routine_id and deleted_at is null;
  select timezone into homestead_timezone from public.homesteads where id=new.homestead_id;
  yield_date := (new.occurred_at at time zone coalesce(homestead_timezone,'America/New_York'))::date;
  if occurrence.id is null or routine.id is null or routine.record_id is distinct from new.record_id or occurrence.occurrence_date is distinct from yield_date
    or (routine.routine_type='milk_morning' and (new.yield_type<>'milk' or new.session<>'morning'))
    or (routine.routine_type='milk_evening' and (new.yield_type<>'milk' or new.session<>'evening'))
    or (routine.routine_type='egg_collection' and (new.yield_type<>'eggs' or new.session<>'other')) then raise exception 'Yield does not match the linked Routine' using errcode='23514'; end if;
  if not public.can_complete_routine(routine.id) then raise exception 'Not authorized to complete the linked Routine' using errcode='42501'; end if;
  if occurrence.status='pending' then perform set_config('regula.allow_routine_completion','true',true); update public.routine_occurrences set status='completed',completion_method='yield',completed_at=now(),completed_by=actor,updated_by=actor where id=occurrence.id; end if;
  return new;
end $$;
create trigger complete_routine_from_yield after insert on public.yield_entries for each row execute function private.complete_routine_from_yield();

-- Yield-linked migrated Tasks must never generate another Task occurrence.
create or replace function private.complete_task_from_yield()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.routine_occurrence_id is not null then return new; end if;
  if new.task_id is null then return new; end if;
  if public.current_homestead_id() is distinct from new.homestead_id or not public.has_capability('complete_tasks') then raise exception 'Not authorized to complete the linked Task' using errcode='42501'; end if;
  perform public.complete_recurring_task(new.task_id, 'yield:' || new.id::text, new.id);
  return new;
end $$;

create or replace function private.change_routine_deleted_state(target_table text,target_id uuid,restore boolean)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_user(); tenant uuid:=public.current_homestead_id(); begin
  if target_table not in ('chore_windows','routines','routine_occurrences') or tenant is null or not public.has_capability('create_tasks') then raise exception 'Not authorized' using errcode='42501'; end if;
  perform set_config('regula.allow_deleted_state','true',true);
  execute format('update public.%I set deleted_at=$1,deleted_by=$2,updated_by=$2 where id=$3 and homestead_id=$4',target_table) using case when restore then null else now() end,case when restore then null else actor end,target_id,tenant;
  if not found then raise exception 'Row not found' using errcode='P0002'; end if;
end $$;
create or replace function public.soft_delete_row(target_table text,target_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin if target_table in ('chore_windows','routines','routine_occurrences') then perform private.change_routine_deleted_state(target_table,target_id,false); elsif target_table = 'homestead_people' then perform private.change_person_deleted_state(target_id,false); elsif target_table in ('calendar_events','yield_entries') then perform private.change_housekeeping_deleted_state(target_table,target_id,false); else perform private.change_deleted_state(target_table,target_id,false); end if; end $$;
create or replace function public.restore_row(target_table text,target_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin if target_table in ('chore_windows','routines','routine_occurrences') then perform private.change_routine_deleted_state(target_table,target_id,true); elsif target_table = 'homestead_people' then perform private.change_person_deleted_state(target_id,true); elsif target_table in ('calendar_events','yield_entries') then perform private.change_housekeeping_deleted_state(target_table,target_id,true); else perform private.change_deleted_state(target_table,target_id,true); end if; end $$;

revoke execute on function private.validate_routine_homestead() from public,anon,authenticated;
revoke execute on function private.protect_routine_completion() from public,anon,authenticated;
revoke execute on function private.advance_routine_occurrence() from public,anon,authenticated;
revoke execute on function private.create_default_chore_windows() from public,anon,authenticated;
revoke execute on function private.promote_yield_routine_occurrence() from public,anon,authenticated;
revoke execute on function private.complete_routine_from_yield() from public,anon,authenticated;
revoke execute on function private.change_routine_deleted_state(text,uuid,boolean) from public,anon,authenticated;
revoke execute on function public.can_complete_routine(uuid) from public,anon;
grant execute on function public.can_complete_routine(uuid) to authenticated;
revoke execute on function public.apply_routine_sync_operation(text,uuid,text,uuid,text,integer,timestamptz,jsonb) from public,anon;
grant execute on function public.apply_routine_sync_operation(text,uuid,text,uuid,text,integer,timestamptz,jsonb) to authenticated;
