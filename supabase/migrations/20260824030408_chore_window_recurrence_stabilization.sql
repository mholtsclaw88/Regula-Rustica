-- Stabilize recurring Task series and add optional Chore Window boundaries.

alter table public.chore_windows
  add column start_time time without time zone,
  add column end_time time without time zone;

alter table public.chore_windows
  add constraint chore_windows_time_order_check
  check (start_time is null or end_time is null or end_time >= start_time);

-- Give every existing recurring chain one durable series identity. Suggested
-- Task chains use one identity per Record/suggestion so re-enable cannot fork.
with recursive task_ancestors as (
  select t.id, t.id as ancestor_id, t.parent_task_id, 0 as depth
  from public.tasks t
  where t.recurrence_rule is not null
  union all
  select a.id, parent.id, parent.parent_task_id, a.depth + 1
  from task_ancestors a
  join public.tasks parent on parent.id = a.parent_task_id
  where a.depth < 100
), roots as (
  select distinct on (id) id, ancestor_id
  from task_ancestors
  order by id, depth desc
), suggested_series as (
  select distinct on (homestead_id, record_id, suggestion_key)
    homestead_id, record_id, suggestion_key, id
  from public.tasks
  where recurrence_rule is not null and suggestion_key is not null
  order by homestead_id, record_id, suggestion_key, created_at, id
), series_map as (
  select r.id, coalesce(s.id, r.ancestor_id) as series_id
  from roots r
  join public.tasks existing on existing.id = r.id
  left join suggested_series s
    on s.homestead_id = existing.homestead_id
   and s.record_id is not distinct from existing.record_id
   and s.suggestion_key = existing.suggestion_key
)
update public.tasks t
set recurrence_rule = jsonb_set(
  jsonb_set(t.recurrence_rule, '{seriesId}', to_jsonb(m.series_id::text), true),
  '{enabled}', coalesce(t.recurrence_rule -> 'enabled', 'true'::jsonb), true
)
from series_map m
where m.id = t.id;

-- Preserve history but retire any duplicate active occurrence before enforcing
-- one active row per series and work date.
select set_config('regula.allow_deleted_state', 'true', true);
with duplicates as (
  select id, row_number() over (
    partition by homestead_id, recurrence_rule ->> 'seriesId', due_date
    order by case when status = 'completed' then 0 else 1 end, created_at, id
  ) as position
  from public.tasks
  where deleted_at is null
    and due_date is not null
    and recurrence_rule ->> 'seriesId' is not null
)
update public.tasks t
set deleted_at = now(), updated_at = now()
from duplicates d
where d.id = t.id and d.position > 1;

create unique index tasks_recurrence_series_date_unique_idx
  on public.tasks (homestead_id, (recurrence_rule ->> 'seriesId'), due_date)
  where deleted_at is null
    and due_date is not null
    and recurrence_rule ->> 'seriesId' is not null;

create or replace function public.complete_recurring_task(task_to_complete uuid,operation_key text,client_device_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_user();tenant uuid:=public.current_homestead_id();current_task public.tasks%rowtype;next_id uuid;base_date date;next_due date;every_n integer;series_id text;
begin
  if tenant is null or not public.has_capability('complete_tasks') then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into current_task from public.tasks where id=task_to_complete and homestead_id=tenant and deleted_at is null for update;
  if current_task.id is null then raise exception 'Task not found' using errcode='P0002'; end if;
  series_id:=current_task.recurrence_rule->>'seriesId';
  if current_task.status='completed' then
    select id into next_id from public.tasks
    where homestead_id=tenant and deleted_at is null
      and ((series_id is not null and recurrence_rule->>'seriesId'=series_id) or parent_task_id=current_task.id)
      and coalesce(due_date,available_from)>coalesce(current_task.due_date,current_task.available_from)
    order by coalesce(due_date,available_from),created_at limit 1;
    return next_id;
  end if;
  if public.current_member_role()='hand' and not exists(select 1 from public.task_assignments a join public.homestead_members m on m.id=a.member_id where a.task_id=current_task.id and a.removed_at is null and m.user_id=actor and m.status='active') then raise exception 'Task is not assigned to this member' using errcode='42501'; end if;
  perform set_config('regula.allow_task_completion','true',true);
  update public.tasks set status='completed',completed_at=now(),completed_by=actor,updated_by=actor where id=current_task.id;
  if current_task.recurrence_rule is not null and coalesce((current_task.recurrence_rule->>'enabled')::boolean,true) then
    every_n:=greatest(coalesce((current_task.recurrence_rule->>'interval')::integer,1),1);
    base_date:=case when current_task.recurrence_rule->>'mode'='after_completion' then current_date else coalesce(current_task.due_date,current_date) end;
    next_due:=case current_task.recurrence_rule->>'frequency' when 'daily' then base_date+every_n when 'weekly' then base_date+(7*every_n) when 'monthly' then (base_date+make_interval(months=>every_n))::date end;
    if next_due is null then raise exception 'Unsupported recurrence frequency' using errcode='22023'; end if;
    insert into public.tasks(homestead_id,record_id,parent_task_id,title,description,status,priority,due_date,recurrence_rule,chore_window_id,yield_type,suggestion_key,created_by,updated_by,source)
    values(tenant,current_task.record_id,current_task.id,current_task.title,current_task.description,'open',current_task.priority,next_due,current_task.recurrence_rule,current_task.chore_window_id,current_task.yield_type,current_task.suggestion_key,actor,actor,'system')
    on conflict do nothing returning id into next_id;
    if next_id is null and series_id is not null then
      select id into next_id from public.tasks where homestead_id=tenant and deleted_at is null and recurrence_rule->>'seriesId'=series_id and due_date=next_due limit 1;
    end if;
  end if;
  insert into public.sync_operations(homestead_id,user_id,device_id,idempotency_key,operation_type,table_name,row_id,request_hash,status,processed_at)
  values(tenant,actor,client_device_id,operation_key,'complete_task','tasks',current_task.id,encode(extensions.digest(current_task.id::text||':'||operation_key,'sha256'),'hex'),'processed',now()) on conflict(homestead_id,user_id,idempotency_key) do nothing;
  return next_id;
end $$;

create or replace function public.apply_task_sync_operation(operation_key text,client_device_id uuid,target_table text,target_id uuid,operation_kind text,expected_version integer,client_timestamp timestamptz,operation_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_user();tenant uuid:=public.current_homestead_id();request_digest text;prior public.sync_operations%rowtype;current_task public.tasks%rowtype;current_row jsonb;result jsonb;series_id text;task_due date;
begin
  if tenant is null or target_table<>'tasks' or operation_kind not in ('create','update','soft_delete','restore') then raise exception 'Unsupported Task sync operation' using errcode='22023'; end if;
  operation_payload:=coalesce(operation_payload,'{}'::jsonb);
  request_digest:=encode(extensions.digest(concat_ws(':',client_device_id,target_table,target_id,operation_kind,coalesce(expected_version::text,''),coalesce(client_timestamp::text,''),operation_payload::text),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(concat_ws(':',tenant,actor,operation_key),0));
  select * into prior from public.sync_operations where homestead_id=tenant and user_id=actor and idempotency_key=operation_key for update;
  if prior.id is not null then if prior.request_hash is distinct from request_digest then raise exception 'Idempotency key was reused for a different request' using errcode='22023'; end if; return prior.response; end if;
  if operation_kind='create' then
    if not public.has_capability('create_tasks') then raise exception 'Not authorized' using errcode='42501'; end if;
    insert into public.tasks(id,homestead_id,record_id,title,description,status,priority,available_from,due_date,recurrence_rule,parent_task_id,chore_window_id,yield_type,suggestion_key,created_by,updated_by,client_updated_at)
    values(target_id,tenant,(operation_payload->>'record_id')::uuid,operation_payload->>'title',operation_payload->>'description',coalesce(operation_payload->>'status','open'),coalesce(operation_payload->>'priority','normal'),(operation_payload->>'available_from')::date,(operation_payload->>'due_date')::date,nullif(operation_payload->'recurrence_rule','null'::jsonb),(operation_payload->>'parent_task_id')::uuid,(operation_payload->>'chore_window_id')::uuid,operation_payload->>'yield_type',operation_payload->>'suggestion_key',actor,actor,client_timestamp)
    on conflict do nothing returning * into current_task;
    if current_task.id is null then
      series_id:=operation_payload->'recurrence_rule'->>'seriesId'; task_due:=(operation_payload->>'due_date')::date;
      if series_id is not null and task_due is not null then select * into current_task from public.tasks where homestead_id=tenant and deleted_at is null and recurrence_rule->>'seriesId'=series_id and due_date=task_due limit 1; end if;
    end if;
  elsif operation_kind='update' and operation_payload->>'status'='completed' then
    perform public.complete_recurring_task(target_id,operation_key||':complete',client_device_id); select * into current_task from public.tasks where id=target_id and homestead_id=tenant;
  else
    if expected_version is null or not public.has_capability('create_tasks') then raise exception 'Not authorized' using errcode='42501'; end if;
    if operation_kind in ('soft_delete','restore') then perform set_config('regula.allow_deleted_state','true',true); update public.tasks set deleted_at=case when operation_kind='restore' then null else now() end,deleted_by=case when operation_kind='restore' then null else actor end,updated_by=actor,client_updated_at=client_timestamp where id=target_id and homestead_id=tenant and version=expected_version returning * into current_task;
    else update public.tasks set record_id=(operation_payload->>'record_id')::uuid,title=operation_payload->>'title',description=operation_payload->>'description',status=operation_payload->>'status',priority=operation_payload->>'priority',available_from=(operation_payload->>'available_from')::date,due_date=(operation_payload->>'due_date')::date,recurrence_rule=nullif(operation_payload->'recurrence_rule','null'::jsonb),parent_task_id=(operation_payload->>'parent_task_id')::uuid,chore_window_id=(operation_payload->>'chore_window_id')::uuid,yield_type=operation_payload->>'yield_type',suggestion_key=operation_payload->>'suggestion_key',updated_by=actor,client_updated_at=client_timestamp where id=target_id and homestead_id=tenant and version=expected_version returning * into current_task; end if;
  end if;
  current_row:=to_jsonb(current_task); result:=jsonb_build_object('status',case when current_task.id is null then 'conflict' else 'applied' end,'row',current_row);
  insert into public.sync_operations(homestead_id,user_id,device_id,idempotency_key,operation_type,table_name,row_id,request_hash,status,response,processed_at) values(tenant,actor,client_device_id,operation_key,operation_kind,'tasks',target_id,request_digest,'processed',result,now());
  return result;
end $$;

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
      insert into public.chore_windows(id,homestead_id,system_key,name,display_order,enabled,daypart,start_time,end_time,created_by,updated_by,client_updated_at)
      values(target_id,tenant,operation_payload->>'system_key',operation_payload->>'name',coalesce((operation_payload->>'display_order')::integer,0),coalesce((operation_payload->>'enabled')::boolean,true),operation_payload->>'daypart',(operation_payload->>'start_time')::time,(operation_payload->>'end_time')::time,actor,actor,client_timestamp) on conflict(id) do nothing returning to_jsonb(chore_windows.*) into current_row;
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
    elsif target_table = 'chore_windows' then update public.chore_windows set system_key=operation_payload->>'system_key',name=operation_payload->>'name',display_order=coalesce((operation_payload->>'display_order')::integer,0),enabled=coalesce((operation_payload->>'enabled')::boolean,true),daypart=operation_payload->>'daypart',start_time=(operation_payload->>'start_time')::time,end_time=(operation_payload->>'end_time')::time,updated_by=actor,client_updated_at=client_timestamp where id=target_id and homestead_id=tenant and version=expected_version returning to_jsonb(chore_windows.*) into current_row;
    elsif target_table = 'routines' then update public.routines set record_id=(operation_payload->>'record_id')::uuid,chore_window_id=(operation_payload->>'chore_window_id')::uuid,person_id=(operation_payload->>'person_id')::uuid,name=operation_payload->>'name',routine_type=operation_payload->>'routine_type',enabled=coalesce((operation_payload->>'enabled')::boolean,true),frequency=operation_payload->>'frequency',interval=coalesce((operation_payload->>'interval')::integer,1),first_date=(operation_payload->>'first_date')::date,next_date=(operation_payload->>'next_date')::date,updated_by=actor,client_updated_at=client_timestamp where id=target_id and homestead_id=tenant and version=expected_version returning to_jsonb(routines.*) into current_row;
    else perform set_config('regula.allow_routine_completion','true',true); update public.routine_occurrences set status=operation_payload->>'status',completion_method=operation_payload->>'completion_method',completed_at=(operation_payload->>'completed_at')::timestamptz,completed_by=case when operation_payload->>'status' in ('completed','skipped') then actor end,updated_by=actor,client_updated_at=client_timestamp where id=target_id and homestead_id=tenant and version=expected_version returning to_jsonb(routine_occurrences.*) into current_row;
    end if;
  end if;
  if current_row is null then execute format('select to_jsonb(t.*) from public.%I t where t.id=$1 and t.homestead_id=$2',target_table) into current_row using target_id,tenant; result:=jsonb_build_object('status','conflict','row',current_row); else result:=jsonb_build_object('status','applied','row',current_row); end if;
  insert into public.sync_operations(homestead_id,user_id,device_id,idempotency_key,operation_type,table_name,row_id,request_hash,status,response,processed_at) values(tenant,actor,client_device_id,operation_key,operation_kind,target_table,target_id,request_digest,'processed',result,now());
  return result;
end $$;
