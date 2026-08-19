-- Unified Tasks + Suggested Tasks + Yield Foundation.
-- Suggested Tasks remain client templates; only enabled Tasks are persisted.

alter table public.tasks
  add column chore_window_id uuid references public.chore_windows(id) on delete set null,
  add column yield_type text,
  add column suggestion_key text;

alter table public.tasks add constraint tasks_yield_type_check
  check (yield_type is null or yield_type in ('milk','eggs','meat','harvest','forage'));
create index tasks_chore_window_due_idx on public.tasks(homestead_id,chore_window_id,due_date) where deleted_at is null;
create index tasks_suggestion_idx on public.tasks(homestead_id,record_id,suggestion_key) where suggestion_key is not null;

alter table public.yield_entries drop constraint if exists yield_entries_yield_type_check;
alter table public.yield_entries drop constraint if exists yield_entries_check;
alter table public.yield_entries add constraint yield_entries_yield_type_check
  check (yield_type in ('milk','eggs','meat','harvest','forage'));
alter table public.yield_entries add constraint yield_entries_unusable_quantity_check
  check (unusable_quantity >= 0 and unusable_quantity <= quantity);

create or replace function private.validate_unified_task()
returns trigger language plpgsql set search_path='' as $$
declare linked_tenant uuid; linked_record public.records%rowtype;
begin
  if new.chore_window_id is not null then
    select homestead_id into linked_tenant from public.chore_windows where id=new.chore_window_id and deleted_at is null;
    if linked_tenant is distinct from new.homestead_id then raise exception 'Chore Window belongs to another Homestead' using errcode='23503'; end if;
  end if;
  if new.yield_type is null then return new; end if;
  select * into linked_record from public.records where id=new.record_id and deleted_at is null;
  if linked_record.id is null or linked_record.homestead_id is distinct from new.homestead_id then raise exception 'Yield Tasks require an active Record in this Homestead' using errcode='23503'; end if;
  if new.yield_type='milk' and not (linked_record.type='animal' and lower(coalesce(linked_record.identity->>'purpose',''))='dairy') then raise exception 'Milk Yield requires a dairy Animal' using errcode='23514'; end if;
  if new.yield_type='eggs' and not (linked_record.type='animal' and lower(coalesce(linked_record.identity->>'purpose','')) in ('eggs','laying')) then raise exception 'Egg Yield requires a laying Animal' using errcode='23514'; end if;
  if new.yield_type='meat' and linked_record.type<>'animal' then raise exception 'Meat Harvest requires an Animal' using errcode='23514'; end if;
  if new.yield_type in ('harvest','forage') and linked_record.type<>'land' then raise exception 'Harvest Yield requires Land' using errcode='23514'; end if;
  return new;
end $$;
create trigger validate_unified_task before insert or update on public.tasks for each row execute function private.validate_unified_task();

create or replace function private.validate_yield_task_link()
returns trigger language plpgsql set search_path='' as $$
declare linked_task public.tasks%rowtype; homestead_timezone text; yield_date date; expected_yield_type text; legacy_routine_type text;
begin
  if new.task_id is null and new.details ? 'task_id' and nullif(new.details->>'task_id','') is not null then new.task_id=(new.details->>'task_id')::uuid; end if;
  new.details:=new.details-'task_id';
  if tg_op='UPDATE' and old.task_id is not null and new.task_id is distinct from old.task_id then raise exception 'A Yield cannot be relinked from its completed Task' using errcode='23514'; end if;
  if new.task_id is null then return new; end if;
  select * into linked_task from public.tasks where id=new.task_id and deleted_at is null;
  if linked_task.id is null or linked_task.homestead_id is distinct from new.homestead_id then raise exception 'Task belongs to another Homestead' using errcode='23503'; end if;
  select timezone into homestead_timezone from public.homesteads where id=new.homestead_id;
  yield_date:=(new.occurred_at at time zone coalesce(homestead_timezone,'America/New_York'))::date;
  legacy_routine_type:=linked_task.recurrence_rule->>'routineType';
  expected_yield_type:=coalesce(linked_task.yield_type,case when legacy_routine_type in ('milk_morning','milk_evening') then 'milk' when legacy_routine_type='egg_collection' then 'eggs' end);
  if linked_task.record_id is distinct from new.record_id
    or expected_yield_type is distinct from new.yield_type or coalesce(linked_task.due_date,linked_task.available_from) is distinct from yield_date
    or (legacy_routine_type='milk_morning' and new.session<>'morning') or (legacy_routine_type='milk_evening' and new.session<>'evening')
  then
    if legacy_routine_type is not null then raise exception 'Yield does not match the linked Routine' using errcode='23514'; end if;
    raise exception 'Yield does not match the linked Task' using errcode='23514';
  end if;
  return new;
end $$;

create or replace function public.complete_recurring_task(task_to_complete uuid,operation_key text,client_device_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_user();tenant uuid:=public.current_homestead_id();current_task public.tasks%rowtype;next_id uuid;base_date date;next_due date;every_n integer;
begin
  if tenant is null or not public.has_capability('complete_tasks') then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into current_task from public.tasks where id=task_to_complete and homestead_id=tenant and deleted_at is null for update;
  if current_task.id is null then raise exception 'Task not found' using errcode='P0002'; end if;
  if current_task.status='completed' then select id into next_id from public.tasks where parent_task_id=current_task.id; return next_id; end if;
  if public.current_member_role()='hand' and not exists(select 1 from public.task_assignments a join public.homestead_members m on m.id=a.member_id where a.task_id=current_task.id and a.removed_at is null and m.user_id=actor and m.status='active') then raise exception 'Task is not assigned to this member' using errcode='42501'; end if;
  perform set_config('regula.allow_task_completion','true',true);
  update public.tasks set status='completed',completed_at=now(),completed_by=actor,updated_by=actor where id=current_task.id;
  if current_task.recurrence_rule is not null then
    every_n:=greatest(coalesce((current_task.recurrence_rule->>'interval')::integer,1),1);
    base_date:=case when current_task.recurrence_rule->>'mode'='after_completion' then current_date else coalesce(current_task.due_date,current_date) end;
    next_due:=case current_task.recurrence_rule->>'frequency' when 'daily' then base_date+every_n when 'weekly' then base_date+(7*every_n) when 'monthly' then (base_date+make_interval(months=>every_n))::date end;
    if next_due is null then raise exception 'Unsupported recurrence frequency' using errcode='22023'; end if;
    insert into public.tasks(homestead_id,record_id,parent_task_id,title,description,status,priority,due_date,recurrence_rule,chore_window_id,yield_type,suggestion_key,created_by,updated_by,source)
    values(tenant,current_task.record_id,current_task.id,current_task.title,current_task.description,'open',current_task.priority,next_due,current_task.recurrence_rule,current_task.chore_window_id,current_task.yield_type,current_task.suggestion_key,actor,actor,'system') returning id into next_id;
  end if;
  insert into public.sync_operations(homestead_id,user_id,device_id,idempotency_key,operation_type,table_name,row_id,request_hash,status,processed_at)
  values(tenant,actor,client_device_id,operation_key,'complete_task','tasks',current_task.id,encode(extensions.digest(current_task.id::text||':'||operation_key,'sha256'),'hex'),'processed',now()) on conflict(homestead_id,user_id,idempotency_key) do nothing;
  return next_id;
end $$;

create or replace function public.apply_task_sync_operation(operation_key text,client_device_id uuid,target_table text,target_id uuid,operation_kind text,expected_version integer,client_timestamp timestamptz,operation_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_user();tenant uuid:=public.current_homestead_id();request_digest text;prior public.sync_operations%rowtype;current_task public.tasks%rowtype;current_row jsonb;result jsonb;
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
    on conflict(id) do nothing returning * into current_task;
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

revoke execute on function private.validate_unified_task() from public,anon,authenticated;
revoke execute on function public.apply_task_sync_operation(text,uuid,text,uuid,text,integer,timestamptz,jsonb) from public,anon;
grant execute on function public.apply_task_sync_operation(text,uuid,text,uuid,text,integer,timestamptz,jsonb) to authenticated;
